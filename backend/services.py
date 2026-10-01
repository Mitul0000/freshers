import base64
import io
import logging
import os
import re
import smtplib
import time
from email.message import EmailMessage
from logging.handlers import RotatingFileHandler
from typing import Tuple

import qrcode
from dotenv import load_dotenv
from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

TEMPLATE_PATH = os.path.join(BASE_DIR, "ticket_template.png")
QR_DIR = os.path.join(BASE_DIR, "qr")
PDF_DIR = os.path.join(BASE_DIR, "tickets")
LOG_DIR = os.path.join(BASE_DIR, "logs")

for d in (QR_DIR, PDF_DIR, LOG_DIR):
    os.makedirs(d, exist_ok=True)

logger = logging.getLogger("freshers")
logger.setLevel(logging.INFO)

if not logger.handlers:
    fmt = logging.Formatter("%(asctime)s | %(levelname)-7s | %(message)s")

    file_handler = RotatingFileHandler(
        os.path.join(LOG_DIR, "app.log"), maxBytes=2_000_000, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(fmt)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

email_logger = logging.getLogger("freshers.email")
email_logger.setLevel(logging.INFO)
email_logger.propagate = False

if not email_logger.handlers:
    email_fmt = logging.Formatter("%(asctime)s | %(levelname)-7s | %(message)s")
    email_file_handler = RotatingFileHandler(
        os.path.join(LOG_DIR, "email.log"), maxBytes=2_000_000, backupCount=5, encoding="utf-8"
    )
    email_file_handler.setFormatter(email_fmt)
    email_logger.addHandler(email_file_handler)

# Titan Mail SMTP Configuration
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.titan.email")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "info@incognito05.tech")
SMTP_PASS = os.getenv("SMTP_PASS", "IncogniTO#90")
FROM_NAME = os.getenv("FROM_NAME", "Incognito 5.0 Team")


def safe_filename(name: str) -> str:
    """'Jay Vandara ' -> 'Jay Vandara' (removes characters Windows/email don't allow)"""
    cleaned = re.sub(r"[^\w\s.-]", "", name, flags=re.UNICODE).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or "ticket"


def _make_qr_image(payload: str, target_size: int = 240) -> Image.Image:
    # High contrast black on white QR with border=4 for instant camera barcode detection
    qr = qrcode.QRCode(
        version=None,
        box_size=4,
        border=4,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img.resize((target_size, target_size), Image.Resampling.LANCZOS)


def create_ticket_pdf(name: str, email: str, token: str, flag_id: Optional[int] = None) -> Tuple[str, str, str]:
    """
    Renders the official Incognito 5.0 - The Waltz ticket poster with embedded QR code.
    Saves Ticket PNG, PDF, and QR image persistently on disk.
    Returns (pdf_path, qr_path, base64_image_data_url).
    """
    # 1. Fast cache check if ticket was already rendered on disk
    if flag_id:
        cached_ticket_png = os.path.join(PDF_DIR, f"ticket_{flag_id}.png")
        if os.path.exists(cached_ticket_png):
            try:
                with open(cached_ticket_png, "rb") as f:
                    cached_bytes = f.read()
                b64_img_url = f"data:image/png;base64,{base64.b64encode(cached_bytes).decode('utf-8')}"
                cached_pdf = os.path.join(PDF_DIR, f"ticket_{flag_id}.pdf")
                cached_qr = os.path.join(QR_DIR, f"qr_{flag_id}.png")
                return cached_pdf, cached_qr, b64_img_url
            except Exception:
                pass

    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Poster not found: {TEMPLATE_PATH} (save it as ticket_template.png)")

    poster = Image.open(TEMPLATE_PATH).convert("RGB")
    pw, ph = poster.size

    # Responsive centering matching the poster layout (proportional to 450/900 and 830/1600)
    center_x = pw // 2
    center_y = int(ph * 0.52)

    # QR dimensions scaled to poster size
    qr_target = int(pw * 0.42)
    qr_img = _make_qr_image(token, target_size=qr_target)

    base_name = safe_filename(name)
    qr_file_name = f"qr_{flag_id}.png" if flag_id else f"{base_name}_{email.replace('@', '_at_')}.png"
    qr_path = os.path.join(QR_DIR, qr_file_name)
    qr_img.save(qr_path)

    card_pad = max(8, int(pw * 0.02))
    card_size = qr_img.width + 2 * card_pad
    card_x = center_x - card_size // 2
    card_y = center_y - card_size // 2

    draw = ImageDraw.Draw(poster)
    # Rounded card border matching Godfather gold with high-contrast white card for effortless camera scanning
    draw.rounded_rectangle(
        [card_x, card_y, card_x + card_size, card_y + card_size],
        radius=14,
        fill="white",
        outline=(181, 148, 16),
        width=4,
    )
    poster.paste(qr_img, (card_x + card_pad, card_y + card_pad))

    # Save rendered PNG buffer for frontend display and PDF embedding
    buf = io.BytesIO()
    poster.save(buf, format="PNG")
    buf.seek(0)
    raw_png = buf.getvalue()
    b64_img_url = f"data:image/png;base64,{base64.b64encode(raw_png).decode('utf-8')}"

    # Persist the rendered ticket PNG to disk
    ticket_png_name = f"ticket_{flag_id}.png" if flag_id else f"{base_name}_ticket.png"
    ticket_png_path = os.path.join(PDF_DIR, ticket_png_name)
    with open(ticket_png_path, "wb") as f:
        f.write(raw_png)

    # Generate PDF
    pdf_name = f"ticket_{flag_id}.pdf" if flag_id else f"{base_name}.pdf"
    pdf_path = os.path.join(PDF_DIR, pdf_name)

    page_w, page_h = poster.width * 0.5, poster.height * 0.5
    c = canvas.Canvas(pdf_path, pagesize=(page_w, page_h))
    buf.seek(0)
    c.drawImage(ImageReader(buf), 0, 0, width=page_w, height=page_h)
    c.setTitle(f"Incognito 5.0 Ticket - {name}")
    c.save()

    logger.info(f"TICKET_CREATED | name={name} | email={email} | flag_id={flag_id} | png={ticket_png_path}")
    return pdf_path, qr_path, b64_img_url


def _build_html_email(name: str) -> str:
    return f"""\
<html>
  <body style="margin:0;padding:0;background-color:#f2f2f2;font-family:Georgia,'Times New Roman',serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f2f2;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color:#0d0d0d;border-radius:4px;overflow:hidden;">
            <tr>
              <td style="padding:40px 48px 36px 48px;">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border:1px solid #b59410;border-radius:50%;width:64px;height:64px;text-align:center;vertical-align:middle;">
                      <span style="color:#d4af37;font-size:28px;">&#127917;</span>
                    </td>
                  </tr>
                </table>

                <p style="color:#c9a227;font-style:italic;font-size:16px;margin:28px 0 6px 0;">
                  An offer you cannot refuse
                </p>

                <h1 style="color:#d4af37;font-size:26px;margin:0 0 20px 0;font-weight:bold;">
                  Hi {name},
                </h1>

                <p style="color:#e8e2d0;font-size:15px;line-height:1.6;margin:0 0 18px 0;">
                  Congratulations on cracking the challenge. Your ticket for
                  <strong style="color:#d4af37;">Incognito 5.0 &mdash; The Waltz</strong> is attached to this email as a PDF.
                </p>

                <table cellpadding="0" cellspacing="0" style="margin:20px 0 24px 0;">
                  <tr>
                    <td style="color:#9a9a9a;font-size:13px;letter-spacing:1px;padding-right:14px;">DATE</td>
                    <td style="color:#e8e2d0;font-size:14px;">05 October 2026</td>
                  </tr>
                  <tr>
                    <td style="color:#9a9a9a;font-size:13px;letter-spacing:1px;padding-right:14px;">TIME</td>
                    <td style="color:#e8e2d0;font-size:14px;">3 PM &ndash; 7 PM</td>
                  </tr>
                  <tr>
                    <td style="color:#9a9a9a;font-size:13px;letter-spacing:1px;padding-right:14px;">VENUE</td>
                    <td style="color:#e8e2d0;font-size:14px;">Upper Auditorium</td>
                  </tr>
                </table>

                <p style="color:#e8e2d0;font-size:14px;line-height:1.6;margin:0 0 8px 0;">
                  Keep the QR code on your ticket ready at the entry gate. It is unique to you &mdash; please do not share it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 48px;border-top:1px solid #2a2a2a;">
                <p style="color:#8a8a8a;font-size:12px;letter-spacing:1px;margin:0;">BEST REGARDS,</p>
                <p style="color:#c9a227;font-size:12px;letter-spacing:1px;margin:2px 0 0 0;">INCOGNITO ORGANISING COMMITTEE</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def send_ticket_email(email: str, name: str, pdf_path: str, retries: int = 3) -> dict:
    host = os.getenv("SMTP_HOST", SMTP_HOST)
    port = int(os.getenv("SMTP_PORT", str(SMTP_PORT)))
    user = os.getenv("SMTP_USER", SMTP_USER)
    pwd = os.getenv("SMTP_PASS", SMTP_PASS)
    from_name = os.getenv("FROM_NAME", FROM_NAME)

    recipient = email.strip()
    if not recipient:
        return {"sent": False, "error": "Empty recipient email"}

    if not user or not pwd:
        logger.error(f"EMAIL_FAILED | to={recipient} | reason=SMTP_USER/SMTP_PASS env vars not set | pdf={pdf_path}")
        email_logger.error(f"FAILED | to={recipient} | name={name} | reason=missing SMTP credentials")
        return {"sent": False, "error": "Missing SMTP credentials"}

    msg = EmailMessage()
    msg["From"] = f"{from_name} <{user}>"
    msg["To"] = recipient
    msg["Subject"] = "Your Incognito 5.0 Freshers' Night Ticket"

    msg.set_content(
        f"Hi {name},\n\n"
        "Congratulations on cracking the challenge!\n"
        "Your ticket for Incognito 5.0 - The Waltz is attached to this email.\n\n"
        "Date  : 05 Oct 2026\nTime  : 3-7 PM\nVenue : Upper Auditorium\n\n"
        "Please keep the QR code ready at the entry gate. Do not share this ticket - it is unique to you.\n\n"
        "Best regards,\nIncognito Organising Committee"
    )
    msg.add_alternative(_build_html_email(name), subtype="html")

    with open(pdf_path, "rb") as f:
        msg.add_attachment(
            f.read(),
            maintype="application",
            subtype="pdf",
            filename=f"{safe_filename(name)}.pdf",
        )

    for attempt in range(1, retries + 1):
        try:
            with smtplib.SMTP_SSL(host, port, timeout=30) as server:
                server.login(user, pwd)
                server.send_message(msg)
            logger.info(f"EMAIL_SENT | to={recipient} | name={name} | attachment={safe_filename(name)}.pdf | attempt={attempt}")
            email_logger.info(f"SENT | to={recipient} | name={name} | attachment={safe_filename(name)}.pdf | attempt={attempt}")
            return {"sent": True, "message": f"Ticket PDF dispatched to {recipient}"}
        except Exception as e:
            logger.warning(f"EMAIL_RETRY | to={email} | attempt={attempt}/{retries} | error={e}")
            email_logger.warning(f"RETRY | to={email} | attempt={attempt}/{retries} | error={e}")
            time.sleep(2 * attempt)

    logger.error(f"EMAIL_FAILED | to={email} | name={name} | pdf={pdf_path} | all {retries} attempts failed")
    email_logger.error(f"FAILED | to={email} | name={name} | pdf={pdf_path} | all {retries} attempts failed")
    return {"sent": False, "error": f"Failed after {retries} attempts"}
