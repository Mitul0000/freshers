"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import OrnateFrame from "@/components/OrnateFrame";
import { soundEffects } from "@/lib/audioEffects";

interface ScanResult {
  status: "success" | "error" | "searching" | "loading";
  message?: string;
  name?: string;
  email?: string;
  ticket_id?: number;
  issued_at?: string;
  verified_at?: string;
  error_code?: string;
}

interface ScanHistoryItem {
  id: string;
  name?: string;
  status: "success" | "error";
  message: string;
  timestamp: string;
}

export default function SecretGatekeeperScannerPage() {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Scanner State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [wsConnected, setWsConnected] = useState(false);
  const [scanStatusText, setScanStatusText] = useState("OPTICAL SCANNER READY");

  // Feedback State
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [stats, setStats] = useState<{ total_tickets?: number; admitted_guests?: number }>({});

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastScannedTokenRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);

  // Check saved session
  useEffect(() => {
    const savedAuth = sessionStorage.getItem("incognito_sanctum_session");
    if (savedAuth === "authorized_consigliere") {
      setIsAuthenticated(true);
    }
  }, []);

  // Fetch telemetry
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStats();
      const interval = setInterval(fetchStats, 12000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchStats]);

  // Authenticate Admin (Hashed check)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.status === "success") {
        sessionStorage.setItem("incognito_sanctum_session", "authorized_consigliere");
        setIsAuthenticated(true);
      } else {
        setAuthError(data.detail || data.message || "Invalid Gatekeeper Credentials");
        soundEffects.playError();
      }
    } catch {
      setAuthError("Failed to reach authentication sanctum");
      soundEffects.playError();
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("incognito_sanctum_session");
    setIsAuthenticated(false);
    stopCamera();
  };

  // Connect WebSocket to /ws/scan
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || `ws://${host}:8000/ws/scan`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setScanStatusText("TARGET SENSORS ONLINE");
      };

      ws.onclose = () => {
        setWsConnected(false);
        setScanStatusText("SENSORS STANDBY (RECONNECTING...)");
        setTimeout(() => {
          if (cameraActive) connectWebSocket();
        }, 3000);
      };

      ws.onerror = () => {
        setWsConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const data: ScanResult = JSON.parse(event.data);
          handleScanFeedback(data);
        } catch {
          // ignore
        }
      };
    } catch {
      setWsConnected(false);
    }
  }, [cameraActive]);

  // Handle Scan Verification Result
  const handleScanFeedback = (result: ScanResult) => {
    if (scanResult) return;

    if (result.status === "searching") {
      setScanStatusText("SCANNING FOR QR CIPHER...");
      return;
    }

    if (result.status === "loading") {
      setScanStatusText("AUTHENTICATING CITATION...");
      return;
    }

    // Concrete result
    setScanResult(result);

    const historyItem: ScanHistoryItem = {
      id: Math.random().toString(36).substring(7),
      name: result.name || "Unknown Guest",
      status: result.status === "success" ? "success" : "error",
      message: result.message || (result.status === "success" ? "Entry allowed" : "Scan rejected"),
      timestamp: new Date().toLocaleTimeString(),
    };

    setHistory((prev) => [historyItem, ...prev.slice(0, 19)]);
    fetchStats();

    if (result.status === "success") {
      soundEffects.playSuccess();
    } else {
      soundEffects.playError();
    }
  };

  // Start Camera
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setCameraActive(true);
      connectWebSocket();
    } catch (err: unknown) {
      const error = err as Error;
      setCameraError(`Camera permission denied: ${error.message}. Please allow camera access in browser settings.`);
      setCameraActive(false);
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setCameraActive(false);
  };

  // Frame Capture Loop
  useEffect(() => {
    if (!cameraActive) return;

    const interval = setInterval(async () => {
      // Pause sending while any modal is open
      if (scanResult) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, width, height);

      // 1. Native BarcodeDetector API for instant client detection
      if ("BarcodeDetector" in window) {
        try {
          const barcodeDetector = new (window as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (canvas: HTMLCanvasElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({ formats: ["qr_code"] });
          const barcodes = await barcodeDetector.detect(canvas);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            const raw = barcodes[0].rawValue;
            const now = Date.now();
            if (raw !== lastScannedTokenRef.current || now - lastScanTimeRef.current > 4000) {
              lastScannedTokenRef.current = raw;
              lastScanTimeRef.current = now;

              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(raw);
              } else {
                fetch("/api/verify-ticket", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ token: raw }),
                })
                  .then((res) => res.json())
                  .then(handleScanFeedback);
              }
              return;
            }
          }
        } catch {
          // fallback to stream
        }
      }

      // 2. Stream raw frame to backend OpenCV
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        canvas.toBlob(
          (blob) => {
            if (blob && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              blob.arrayBuffer().then((buffer) => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(buffer);
                }
              });
            }
          },
          "image/jpeg",
          0.75
        );
      }
    }, 350);

    frameIntervalRef.current = interval;
    return () => clearInterval(interval);
  }, [cameraActive, scanResult]);

  // Flip Camera
  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
    if (cameraActive) {
      stopCamera();
      setTimeout(startCamera, 300);
    }
  };

  const resumeScanning = () => {
    setScanResult(null);
    lastScannedTokenRef.current = null;
    lastScanTimeRef.current = Date.now();
  };

  // -------------------------------------------------------------
  // RENDER: Secret Gatekeeper Login Screen
  // -------------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <>
        <OrnateFrame />
        <div className="grain" />
        <div className="scratches" />

        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            position: "relative",
            zIndex: 10,
          }}
        >
          <div
            className="dossier-card"
            style={{
              maxWidth: "480px",
              width: "100%",
              background: "rgba(14, 10, 7, 0.96)",
              border: "2px solid #e0b563",
              padding: "40px 30px",
              textAlign: "center",
              boxShadow: "0 25px 60px rgba(0,0,0,0.9)",
              borderRadius: "6px",
            }}
          >
            <div
              style={{
                fontSize: "0.85rem",
                letterSpacing: "0.22em",
                color: "#e0b563",
                textTransform: "uppercase",
                marginBottom: "8px",
                fontWeight: 700,
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
            >
              RESTRICTED ENTRY
            </div>

            <h1
              style={{
                fontFamily: "'Godfather', Georgia, serif",
                fontSize: "2.6rem",
                color: "#ffffff",
                margin: "0 0 16px",
              }}
            >
              Admin
            </h1>

            <p
              style={{
                color: "#ded5c0",
                fontSize: "1rem",
                lineHeight: 1.6,
                marginBottom: "28px",
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
            >
              Enter password to access the ticket scanner.
            </p>

            {authError && (
              <div
                style={{
                  background: "rgba(138, 28, 35, 0.4)",
                  border: "1px solid #e53e3e",
                  padding: "12px 16px",
                  color: "#ffffff",
                  fontSize: "0.95rem",
                  marginBottom: "20px",
                  borderRadius: "4px",
                  fontWeight: 600,
                }}
              >
                ⚠️ {authError}
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter Admin Password..."
                required
                style={{
                  width: "100%",
                  padding: "16px",
                  background: "rgba(5, 3, 2, 0.9)",
                  border: "1px solid rgba(224, 181, 99, 0.5)",
                  color: "#ffffff",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontSize: "1.1rem",
                  letterSpacing: "0.1em",
                  textAlign: "center",
                  outline: "none",
                  borderRadius: "4px",
                }}
              />

              <button
                type="submit"
                disabled={authLoading}
                className="btn-seal"
                style={{
                  padding: "16px",
                  fontSize: "1rem",
                  fontWeight: 700,
                  cursor: authLoading ? "wait" : "pointer",
                  borderRadius: "4px",
                }}
              >
                {authLoading ? "AUTHENTICATING..." : "UNLOCK OPTICAL GATE"}
              </button>
            </form>
          </div>
        </main>
      </>
    );
  }

  // -------------------------------------------------------------
  // RENDER: Authenticated Optical Scanner Portal (Mobile Optimized)
  // -------------------------------------------------------------
  return (
    <>
      <OrnateFrame />
      <div className="grain" />
      <div className="scratches" />

      {/* Top Header */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(10, 7, 5, 0.95)",
          borderBottom: "1px solid rgba(184, 146, 63, 0.3)",
          backdropFilter: "blur(10px)",
          padding: "14px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontFamily: "'Godfather', Georgia, serif", fontSize: "1.5rem", color: "#ffffff" }}>
            Incognito 5.0
          </span>
          <span
            style={{
              fontSize: "0.78rem",
              color: "#e0b563",
              border: "1px solid rgba(224, 181, 99, 0.4)",
              padding: "2px 8px",
              borderRadius: "3px",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 700,
            }}
          >
            ADMIN
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.82rem",
              color: wsConnected ? "#68d391" : "#fc8181",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: "9px",
                height: "9px",
                borderRadius: "50%",
                background: wsConnected ? "#48bb78" : "#e53e3e",
                boxShadow: `0 0 8px ${wsConnected ? "#48bb78" : "#e53e3e"}`,
              }}
            />
            {wsConnected ? "ONLINE" : "OFFLINE"}
          </span>

          <button
            onClick={handleLogout}
            style={{
              background: "rgba(184, 146, 63, 0.15)",
              border: "1px solid rgba(184, 146, 63, 0.4)",
              color: "#ded5c0",
              padding: "6px 14px",
              fontSize: "0.85rem",
              cursor: "pointer",
              borderRadius: "3px",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <main style={{ padding: "20px 16px 60px", position: "relative", zIndex: 10 }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          {/* CAMERA VIEWFINDER HUD */}
          <div
            className="dossier-card"
            style={{
              background: "rgba(12, 8, 6, 0.95)",
              border: "2px solid #e0b563",
              borderRadius: "6px",
              padding: "16px",
              marginBottom: "24px",
              boxShadow: "0 15px 40px rgba(0,0,0,0.85)",
            }}
          >
            {/* Viewfinder Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: cameraActive ? "#48bb78" : "#e0b563",
                    boxShadow: cameraActive ? "0 0 10px #48bb78" : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    color: "#ffffff",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                  }}
                >
                  LIVE OPTICAL SCANNER
                </span>
              </div>

              {cameraActive && (
                <button
                  onClick={toggleFacingMode}
                  style={{
                    background: "rgba(224, 181, 99, 0.2)",
                    border: "1px solid #e0b563",
                    color: "#ffffff",
                    padding: "6px 14px",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    borderRadius: "4px",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                  }}
                >
                  Flip ({facingMode === "environment" ? "Rear" : "Front"})
                </button>
              )}
            </div>

            {/* Video Canvas Box */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "52vh",
                minHeight: "340px",
                maxHeight: "560px",
                background: "#000000",
                borderRadius: "4px",
                overflow: "hidden",
                border: "1px solid rgba(224, 181, 99, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: cameraActive ? "block" : "none",
                }}
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />

              {/* Offline Screen */}
              {!cameraActive && (
                <div style={{ textAlign: "center", padding: "20px" }}>
                  <div style={{ fontSize: "3rem", marginBottom: "12px", color: "#e0b563" }}>📷</div>
                  <h3
                    style={{
                      fontFamily: "'Godfather', Georgia, serif",
                      fontSize: "2rem",
                      color: "#ffffff",
                      marginBottom: "8px",
                    }}
                  >
                    SCANNER READY
                  </h3>
                  <p
                    style={{
                      color: "#ded5c0",
                      fontSize: "1rem",
                      maxWidth: "360px",
                      margin: "0 auto 20px",
                      fontFamily: "system-ui, -apple-system, sans-serif",
                    }}
                  >
                    Tap the button below to turn on the camera and start scanning attendee tickets.
                  </p>
                  <button onClick={startCamera} className="btn-seal" style={{ padding: "16px 36px", fontSize: "1.05rem", borderRadius: "4px" }}>
                    ACTIVATE CAMERA
                  </button>
                </div>
              )}

              {/* Camera Error Message */}
              {cameraError && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(10, 5, 5, 0.95)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "24px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "2.2rem", color: "#e53e3e", marginBottom: "12px" }}>⚠️</div>
                  <div style={{ color: "#ffffff", fontSize: "1rem", marginBottom: "20px", maxWidth: "420px" }}>{cameraError}</div>
                  <button onClick={startCamera} className="btn-ghost">
                    RETRY PERMISSION
                  </button>
                </div>
              )}

              {/* HUD Targeting Box (When Active) */}
              {cameraActive && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      width: "250px",
                      height: "250px",
                      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
                    }}
                  >
                    {/* Reticle Brackets */}
                    <div className="hud-corner top-left" />
                    <div className="hud-corner top-right" />
                    <div className="hud-corner bottom-left" />
                    <div className="hud-corner bottom-right" />

                    {/* Animated Gold Laser Sweep */}
                    <div className="laser-beam" />
                  </div>

                  <div
                    style={{
                      marginTop: "16px",
                      background: "rgba(0, 0, 0, 0.8)",
                      border: "1px solid #e0b563",
                      padding: "6px 16px",
                      borderRadius: "4px",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      color: "#ffffff",
                      fontFamily: "system-ui, -apple-system, sans-serif",
                    }}
                  >
                    {scanStatusText}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Controls */}
            {cameraActive && (
              <div style={{ marginTop: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.82rem", color: "#c2b8a3", fontFamily: "system-ui, -apple-system, sans-serif" }}>
                  POINT CAMERA AT THE QR CODE
                </span>
                <button
                  onClick={stopCamera}
                  style={{
                    background: "transparent",
                    border: "1px solid #e53e3e",
                    color: "#fc8181",
                    padding: "8px 16px",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    borderRadius: "4px",
                  }}
                >
                  Pause Camera
                </button>
              </div>
            )}
          </div>

          {/* SCAN RESULT OVERLAY MODAL */}
          {scanResult && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 100,
                background: scanResult.status === "success" ? "rgba(5, 25, 10, 0.88)" : "rgba(35, 5, 10, 0.9)",
                backdropFilter: "blur(10px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <div
                style={{
                  maxWidth: "500px",
                  width: "100%",
                  background: "#120e0a",
                  border: `3px solid ${scanResult.status === "success" ? "#48bb78" : "#e53e3e"}`,
                  boxShadow: `0 0 50px ${scanResult.status === "success" ? "rgba(72, 187, 120, 0.5)" : "rgba(229, 62, 62, 0.6)"}`,
                  padding: "36px 28px",
                  textAlign: "center",
                  borderRadius: "6px",
                  animation: "stampImpact 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                }}
              >
                {/* Result Stamp */}
                {scanResult.status === "success" ? (
                  <div
                    style={{
                      display: "inline-block",
                      border: "3px solid #48bb78",
                      color: "#48bb78",
                      padding: "8px 24px",
                      fontSize: "1.2rem",
                      fontWeight: 900,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      transform: "rotate(-2deg)",
                      marginBottom: "18px",
                      borderRadius: "4px",
                      boxShadow: "0 0 20px rgba(72, 187, 120, 0.4)",
                    }}
                  >
                    ✓ ENTRY ALLOWED
                  </div>
                ) : (
                  <div
                    style={{
                      display: "inline-block",
                      border: "3px solid #e53e3e",
                      color: "#e53e3e",
                      padding: "8px 24px",
                      fontSize: "1.2rem",
                      fontWeight: 900,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      transform: "rotate(-2deg)",
                      marginBottom: "18px",
                      borderRadius: "4px",
                      boxShadow: "0 0 20px rgba(229, 62, 62, 0.4)",
                    }}
                  >
                    ✕ {scanResult.error_code === "ALREADY_USED" ? "ALREADY USED" : "ACCESS DENIED"}
                  </div>
                )}

                {/* Attendee Name */}
                <h2
                  style={{
                    fontFamily: "'Godfather', Georgia, serif",
                    fontSize: "2.4rem",
                    color: "#ffffff",
                    margin: "0 0 10px",
                  }}
                >
                  {scanResult.name || "UNAUTHORIZED PASS"}
                </h2>

                <p
                  style={{
                    color: "#ded5c0",
                    fontSize: "1.1rem",
                    marginBottom: "20px",
                    lineHeight: 1.5,
                    fontFamily: "system-ui, -apple-system, sans-serif",
                  }}
                >
                  {scanResult.message}
                </p>

                {/* Citation info */}
                {scanResult.ticket_id && (
                  <div
                    style={{
                      background: "rgba(0,0,0,0.6)",
                      border: "1px dashed rgba(224, 181, 99, 0.4)",
                      padding: "14px",
                      marginBottom: "24px",
                      fontFamily: "monospace",
                      fontSize: "0.9rem",
                      textAlign: "left",
                      color: "#ffffff",
                      borderRadius: "4px",
                    }}
                  >
                    <div>CITATION: #INC5-TK{String(scanResult.ticket_id).padStart(4, "0")}</div>
                    {scanResult.email && <div>EMAIL: {scanResult.email}</div>}
                    <div>VERIFIED: {new Date().toLocaleTimeString()}</div>
                  </div>
                )}

                <button
                  onClick={resumeScanning}
                  className={scanResult.status === "success" ? "btn-seal" : "btn-ghost"}
                  style={{ width: "100%", padding: "16px", fontSize: "1.05rem", fontWeight: 700, borderRadius: "4px" }}
                >
                  SCAN NEXT TICKET &rarr;
                </button>
              </div>
            </div>
          )}

          {/* RECENT SCANS LOG */}
          {history.length > 0 && (
            <div
              className="dossier-card"
              style={{
                background: "rgba(14, 10, 7, 0.95)",
                border: "1px solid rgba(184, 146, 63, 0.3)",
                padding: "20px",
                borderRadius: "4px",
              }}
            >
              <div
                style={{
                  fontSize: "0.85rem",
                  letterSpacing: "0.15em",
                  color: "#e0b563",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  marginBottom: "14px",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
              >
                RECENT SCANS LOG ({history.length})
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {history.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "rgba(5, 3, 2, 0.7)",
                      border: `1px solid ${item.status === "success" ? "rgba(72, 187, 120, 0.3)" : "rgba(229, 62, 62, 0.3)"}`,
                      padding: "10px 14px",
                      borderRadius: "4px",
                      fontSize: "0.9rem",
                    }}
                  >
                    <div>
                      <strong style={{ color: item.status === "success" ? "#e0b563" : "#fc8181" }}>
                        {item.name}
                      </strong>
                      <span style={{ color: "#c2b8a3", marginLeft: "10px", fontSize: "0.82rem" }}>
                        {item.message}
                      </span>
                    </div>
                    <span style={{ color: "#9e917d", fontFamily: "monospace", fontSize: "0.8rem" }}>
                      {item.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <style jsx>{`
        .hud-corner {
          position: absolute;
          width: 30px;
          height: 30px;
          border-color: #e0b563;
        }
        .top-left {
          top: 0;
          left: 0;
          border-top: 3px solid #e0b563;
          border-left: 3px solid #e0b563;
        }
        .top-right {
          top: 0;
          right: 0;
          border-top: 3px solid #e0b563;
          border-right: 3px solid #e0b563;
        }
        .bottom-left {
          bottom: 0;
          left: 0;
          border-bottom: 3px solid #e0b563;
          border-left: 3px solid #e0b563;
        }
        .bottom-right {
          bottom: 0;
          right: 0;
          border-bottom: 3px solid #e0b563;
          border-right: 3px solid #e0b563;
        }

        .laser-beam {
          position: absolute;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, transparent 0%, #e0b563 50%, transparent 100%);
          box-shadow: 0 0 14px #e0b563;
          animation: scanSweep 2s ease-in-out infinite;
        }

        @keyframes scanSweep {
          0% {
            top: 5%;
            opacity: 0.2;
          }
          50% {
            top: 95%;
            opacity: 1;
          }
          100% {
            top: 5%;
            opacity: 0.2;
          }
        }

        @keyframes stampImpact {
          0% {
            opacity: 0;
            transform: scale(1.4) rotate(4deg);
          }
          65% {
            opacity: 1;
            transform: scale(0.97) rotate(-2deg);
          }
          100% {
            transform: scale(1) rotate(0deg);
          }
        }
      `}</style>
    </>
  );
}
