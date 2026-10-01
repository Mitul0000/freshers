import asyncio
import hashlib
import hmac
import logging
import os
import time
from typing import Optional

import cv2
import jwt
import numpy as np
import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services import create_ticket_pdf

# Load environment configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("incognito.backend")

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
REPEAT_WINDOW_SECONDS = float(os.getenv("REPEAT_WINDOW_SECONDS", "3.0"))

# Only SHA-256 hash is kept in code logic for security
# Plaintext password is NEVER stored in code
ADMIN_PASSWORD_HASH = os.getenv(
    "ADMIN_PASSWORD_HASH",
    "24d0a5dd4e11ca3d2c8c323dcb1fc5c064697e9cd7559067bac07ee8550bc317",
)

DB_CONFIG = dict(
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", "5433")),
    dbname=os.getenv("DB_NAME", "freshers_db"),
    user=os.getenv("DB_USER", "admin"),
    password=os.getenv("DB_PASSWORD", "admin_password_123"),
)

origins = [
    "https://incognito05.tech",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "*",
]

app = FastAPI(
    title="Incognito 5.0 — Backend",
    description="Backend API for Flag Verification and Admin QR Scanner",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db_connection():
    """Establish and return a new PostgreSQL database connection."""
    return psycopg2.connect(**DB_CONFIG)


def decode_qr(frame_bytes: bytes) -> Optional[str]:
    """Decode QR code string from raw image frame bytes using OpenCV (multi-pass detection)."""
    try:
        arr = np.frombuffer(frame_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return None
        detector = cv2.QRCodeDetector()

        # Pass 1: Direct color frame
        data, _, _ = detector.detectAndDecode(img)
        if data:
            return data

        # Pass 2: Grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        data, _, _ = detector.detectAndDecode(gray)
        if data:
            return data

        # Pass 3: Contrast equalized (for low or uneven lighting)
        eq = cv2.equalizeHist(gray)
        data, _, _ = detector.detectAndDecode(eq)
        return data or None
    except Exception as e:
        logger.warning(f"Error decoding QR frame: {e}")
        return None


def verify_ticket(token: str) -> dict:
    """Verify ticket JWT and update ticket.is_used = TRUE in PostgreSQL."""
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "email"]},
        )
    except jwt.ExpiredSignatureError:
        return {"status": "error", "message": "Ticket has expired", "error_code": "EXPIRED"}
    except jwt.InvalidTokenError:
        return {"status": "error", "message": "Invalid ticket signature or format", "error_code": "INVALID_TOKEN"}
    except Exception as e:
        return {"status": "error", "message": f"Malformed ticket: {str(e)}", "error_code": "MALFORMED"}

    email = payload.get("email")
    flag_id = payload.get("flag_id")

    conn = None
    try:
        conn = get_db_connection()
        with conn:
            with conn.cursor() as cur:
                # 1. Primary check: If flag_id is in payload, update the specific ticket
                if flag_id:
                    cur.execute(
                        """
                        UPDATE tickets
                        SET is_used = TRUE
                        FROM users
                        WHERE tickets.user_id = users.user_id
                          AND tickets.flag_id = %s
                          AND tickets.is_used = FALSE
                        RETURNING users.name, users.email, tickets.ticket_id, tickets.issued_at
                        """,
                        (flag_id,),
                    )
                    row = cur.fetchone()
                else:
                    row = None

                # 2. Fallback check: If no flag_id in payload, update by user email
                if not row and email:
                    cur.execute(
                        """
                        UPDATE tickets
                        SET is_used = TRUE
                        FROM users
                        WHERE tickets.user_id = users.user_id
                          AND users.email = %s
                          AND tickets.is_used = FALSE
                        RETURNING users.name, users.email, tickets.ticket_id, tickets.issued_at
                        """,
                        (email,),
                    )
                    row = cur.fetchone()

                if row:
                    return {
                        "status": "success",
                        "message": "Verified successfully. Entry allowed.",
                        "name": row[0],
                        "email": row[1],
                        "ticket_id": row[2],
                        "issued_at": str(row[3]),
                        "verified_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    }

                # 3. Check if ticket exists but already used
                if flag_id:
                    cur.execute(
                        """
                        SELECT users.name, tickets.ticket_id, tickets.issued_at
                        FROM tickets
                        JOIN users ON tickets.user_id = users.user_id
                        WHERE tickets.flag_id = %s
                        """,
                        (flag_id,),
                    )
                    exists = cur.fetchone()
                else:
                    exists = None

                if not exists and email:
                    cur.execute(
                        """
                        SELECT users.name, tickets.ticket_id, tickets.issued_at
                        FROM tickets
                        JOIN users ON tickets.user_id = users.user_id
                        WHERE users.email = %s
                        """,
                        (email,),
                    )
                    exists = cur.fetchone()

        if not exists:
            return {
                "status": "error",
                "message": "Invalid QR, no ticket found in records",
                "error_code": "NOT_FOUND",
            }
        return {
            "status": "error",
            "message": "QR already scanned, ticket already used",
            "name": exists[0],
            "ticket_id": exists[1],
            "error_code": "ALREADY_USED",
        }

    except psycopg2.Error as e:
        logger.exception(f"Database error while verifying ticket: {e}")
        return {
            "status": "error",
            "message": "Database server error, please scan again",
            "retryable": True,
        }
    finally:
        if conn is not None:
            conn.close()


# Pydantic Request Models
class FlagValidationRequest(BaseModel):
    flag: str
    email: Optional[str] = None


class TicketVerifyRequest(BaseModel):
    token: str


class AdminLoginRequest(BaseModel):
    password: str


# HTTP Routes
@app.get("/")
def read_root():
    return {
        "title": "Incognito 5.0 — Sanctum API",
        "status": "operational",
        "timestamp": time.time(),
    }


@app.get("/api/health")
def health_check():
    db_ok = False
    try:
        conn = get_db_connection()
        conn.close()
        db_ok = True
    except Exception:
        db_ok = False

    return {
        "status": "ok",
        "database_connected": db_ok,
        "db_host": DB_CONFIG["host"],
        "db_port": DB_CONFIG["port"],
    }


@app.post("/api/admin/login")
def admin_login(req: AdminLoginRequest):
    # Verify input against SHA-256 hash (constant time comparison)
    input_hash = hashlib.sha256(req.password.strip().encode()).hexdigest()
    if hmac.compare_digest(input_hash, ADMIN_PASSWORD_HASH):
        admin_token = jwt.encode(
            {"role": "admin", "exp": int(time.time()) + 24 * 3600},
            JWT_SECRET,
            algorithm=JWT_ALGORITHM,
        )
        return {"status": "success", "token": admin_token, "message": "Access granted to Admin Sanctum"}
    raise HTTPException(status_code=401, detail="Unauthorized: Invalid Consigliere credentials")


# Rate Limiter state for Flag Submission (IP-based: 5 attempts per window, then delay)
flag_rate_limits: dict[str, list[float]] = {}
RATE_LIMIT_ATTEMPTS = 5
RATE_LIMIT_WINDOW_SECONDS = 60.0


@app.get("/api/flag-rate-limit")
def get_flag_rate_limit(request: Request):
    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "127.0.0.1")
    )
    now = time.time()
    valid_attempts = [t for t in flag_rate_limits.get(client_ip, []) if now - t < RATE_LIMIT_WINDOW_SECONDS]
    flag_rate_limits[client_ip] = valid_attempts
    
    if len(valid_attempts) >= RATE_LIMIT_ATTEMPTS:
        wait_seconds = int(RATE_LIMIT_WINDOW_SECONDS - (now - valid_attempts[0]))
        return {"limited": True, "retry_after": max(1, wait_seconds)}
    
    return {"limited": False, "attempts": len(valid_attempts)}


@app.post("/api/validate-flag")
def validate_flag_endpoint(req: FlagValidationRequest, request: Request = None):
    # Check rate limiting per client IP
    client_ip = "127.0.0.1"
    if request:
        client_ip = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "127.0.0.1")
        )
    
    now = time.time()
    if client_ip in flag_rate_limits:
        # Keep only timestamps within window
        valid_attempts = [t for t in flag_rate_limits[client_ip] if now - t < RATE_LIMIT_WINDOW_SECONDS]
        flag_rate_limits[client_ip] = valid_attempts
        if len(valid_attempts) >= RATE_LIMIT_ATTEMPTS:
            wait_seconds = int(RATE_LIMIT_WINDOW_SECONDS - (now - valid_attempts[0]))
            wait_seconds = max(1, wait_seconds)
            return {
                "status": "error",
                "message": f"Too many attempts. Please wait {wait_seconds} seconds before trying again.",
                "error_code": "RATE_LIMITED",
                "retry_after": wait_seconds,
            }

    flag_cleaned = req.flag.strip()
    if not flag_cleaned:
        raise HTTPException(status_code=400, detail="Flag cipher cannot be empty")

    conn = None
    try:
        conn = get_db_connection()
        with conn:
            with conn.cursor() as cur:
                # 1. Lookup flag in user_flags
                query = """
                    SELECT uf.flag_id, uf.user_id, uf.flag, uf.is_used, u.name, u.email
                    FROM user_flags uf
                    JOIN users u ON uf.user_id = u.user_id
                    WHERE TRIM(uf.flag) = %s OR uf.flag_hash = %s
                """
                cur.execute(query, (flag_cleaned, flag_cleaned))
                flag_row = cur.fetchone()

                if not flag_row:
                    # Record failed attempt for rate limiting
                    flag_rate_limits.setdefault(client_ip, []).append(now)
                    return {
                        "status": "error",
                        "message": "Invalid flag",
                        "error_code": "INVALID_FLAG",
                    }

                flag_id, user_id, actual_flag, is_used, user_name, user_email = flag_row

                # 2. Check if flag was already redeemed
                if is_used:
                    # Retrieve the existing ticket
                    cur.execute(
                        """
                        SELECT ticket_id, jwt_token, is_used, issued_at
                        FROM tickets
                        WHERE flag_id = %s
                        ORDER BY ticket_id DESC
                        LIMIT 1
                        """,
                        (flag_id,),
                    )
                    ticket_row = cur.fetchone()

                    # Retrieve ticket poster from disk cache or regenerate
                    b64_poster = None
                    pdf_name = f"ticket_{flag_id}.pdf"
                    if ticket_row and ticket_row[1]:
                        try:
                            pdf_p, _, b64_poster = create_ticket_pdf(
                                name=user_name,
                                email=user_email,
                                token=ticket_row[1],
                                flag_id=flag_id,
                            )
                            pdf_name = os.path.basename(pdf_p)
                        except Exception:
                            b64_poster = None

                    # Return success seamlessly with ticket image - no warning or alert
                    return {
                        "status": "success",
                        "message": "Ticket retrieved successfully.",
                        "name": user_name,
                        "email": user_email,
                        "ticket_id": ticket_row[0] if ticket_row else None,
                        "ticket_used": ticket_row[2] if ticket_row else False,
                        "issued_at": str(ticket_row[3]) if ticket_row else None,
                        "jwt_token": ticket_row[1] if ticket_row else None,
                        "ticket_image": b64_poster,
                        "pdf_name": pdf_name,
                    }

                # 3. Generate JWT Ticket
                exp_timestamp = int(time.time()) + (10 * 24 * 3600)  # 30 days valid
                token_payload = {
                    "email": user_email,
                    "name": user_name,
                    "user_id": user_id,
                    "flag_id": flag_id,
                    "exp": exp_timestamp,
                    "iss": "incognito-5.0",
                }
                jwt_token = jwt.encode(token_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

                # 4. Insert ticket record with ticket image path
                cur.execute(
                    """
                    INSERT INTO tickets (user_id, flag_id, jwt_token, qr_path, is_used, issued_at)
                    VALUES (%s, %s, %s, %s, FALSE, NOW())
                    RETURNING ticket_id, issued_at
                    """,
                    (user_id, flag_id, jwt_token, f"/tickets/ticket_{flag_id}.png"),
                )
                new_ticket = cur.fetchone()
                ticket_id = new_ticket[0]
                issued_at = new_ticket[1]

                # 5. Mark user_flag as used
                cur.execute(
                    """
                    UPDATE user_flags
                    SET is_used = TRUE
                    WHERE flag_id = %s
                    """,
                    (flag_id,),
                )

        # 6. Generate Ticket Poster & PDF (stored persistently on disk, no email sent)
        pdf_path, qr_path, b64_poster_url = create_ticket_pdf(
            name=user_name,
            email=user_email,
            token=jwt_token,
            flag_id=flag_id,
        )

        return {
            "status": "success",
            "message": "Flag verified successfully. Your ticket is ready.",
            "name": user_name,
            "email": user_email,
            "ticket_id": ticket_id,
            "issued_at": str(issued_at),
            "jwt_token": jwt_token,
            "ticket_image": b64_poster_url,
            "pdf_name": os.path.basename(pdf_path),
        }

    except psycopg2.Error as e:
        logger.exception("Database error in validate_flag")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        logger.exception(f"Unexpected error in validate_flag: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn is not None:
            conn.close()


@app.post("/api/verify-ticket")
def http_verify_ticket_endpoint(req: TicketVerifyRequest):
    token = req.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token cannot be empty")
    return verify_ticket(token)


@app.get("/api/admin/stats")
def get_admin_stats():
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users")
            total_users = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM user_flags")
            total_flags = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM user_flags WHERE is_used = TRUE")
            claimed_flags = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM tickets")
            total_tickets = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM tickets WHERE is_used = TRUE")
            admitted_guests = cur.fetchone()[0]

            return {
                "total_users": total_users,
                "total_flags": total_flags,
                "claimed_flags": claimed_flags,
                "total_tickets": total_tickets,
                "admitted_guests": admitted_guests,
            }
    except Exception as e:
        return {"error": str(e)}
    finally:
        if conn:
            conn.close()


@app.get("/api/admin/recent-scans")
def get_recent_scans():
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.ticket_id, u.name, u.email, t.is_used, t.issued_at
                FROM tickets t
                JOIN users u ON t.user_id = u.user_id
                ORDER BY t.ticket_id DESC
                LIMIT 20
                """
            )
            rows = cur.fetchall()
            return [
                {
                    "ticket_id": r[0],
                    "name": r[1],
                    "email": r[2],
                    "is_used": r[3],
                    "issued_at": str(r[4]),
                }
                for r in rows
            ]
    except Exception as e:
        return {"error": str(e)}
    finally:
        if conn:
            conn.close()


# WebSocket Scanner
@app.websocket("/ws/scan")
async def scan(ws: WebSocket):
    await ws.accept()
    last_token = None
    last_seen = 0.0
    last_result = None

    try:
        while True:
            message = await ws.receive()
            if "bytes" in message and message["bytes"]:
                frame = message["bytes"]
                token = await asyncio.to_thread(decode_qr, frame)
            elif "text" in message and message["text"]:
                token = message["text"].strip()
            else:
                await ws.send_json({"status": "searching"})
                continue

            if not token:
                await ws.send_json({"status": "searching"})
                continue

            now = time.monotonic()
            if token == last_token and now - last_seen < REPEAT_WINDOW_SECONDS:
                last_seen = now
                await ws.send_json(last_result)
                continue

            await ws.send_json({"status": "loading"})

            result = await asyncio.to_thread(verify_ticket, token)

            if not result.get("retryable"):
                last_token, last_seen, last_result = token, now, result
            await ws.send_json(result)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
