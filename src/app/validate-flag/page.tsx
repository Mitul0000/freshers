"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import OrnateFrame from "@/components/OrnateFrame";
import { soundEffects } from "@/lib/audioEffects";

interface TicketData {
  status: "success" | "already_claimed" | "error";
  message: string;
  name?: string;
  email?: string;
  ticket_id?: number;
  ticket_used?: boolean;
  issued_at?: string;
  jwt_token?: string;
  ticket_image?: string;
  pdf_name?: string;
  error_code?: string;
  retry_after?: number;
}

export default function ValidateFlagPage() {
  const [flag, setFlag] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TicketData | null>(null);

  // Rate Limiting (5 attempts, then 60 second delay)
  const [attempts, setAttempts] = useState<number>(0);
  const [cooldown, setCooldown] = useState<number>(0);

  // Check IP rate limit on page mount so refresh cannot bypass it
  useEffect(() => {
    fetch("/api/flag-rate-limit")
      .then((res) => res.json())
      .then((data) => {
        if (data.limited && data.retry_after) {
          setCooldown(data.retry_after);
          setResult({
            status: "error",
            message: `Too many attempts. Please wait ${data.retry_after}s before trying again.`,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          setAttempts(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flag.trim()) return;

    if (cooldown > 0) {
      setResult({
        status: "error",
        message: `Too many attempts. Please wait ${cooldown}s before trying again.`,
      });
      soundEffects.playError();
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/validate-flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flag: flag.trim(),
        }),
      });

      const data: TicketData = await res.json();
      setResult(data);

      if (data.status === "success") {
        soundEffects.playSuccess();
        setAttempts(0);
      } else {
        soundEffects.playError();
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);

        if (data.retry_after) {
          setCooldown(data.retry_after);
        } else if (nextAttempts >= 5) {
          setCooldown(60);
          setResult({
            status: "error",
            message: "Too many attempts. Please wait 60s before trying again.",
          });
        }
      }
    } catch {
      setResult({
        status: "error",
        message: "Failed to connect to verification server. Please try again.",
      });
      soundEffects.playError();
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadImage = () => {
    if (!result?.ticket_image) return;
    const a = document.createElement("a");
    a.href = result.ticket_image;
    a.download = `incognito_ticket.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <OrnateFrame />
      <div className="grain" />
      <div className="scratches" />

      {/* Navigation bar matching home screen */}
      <nav
        className="site-nav pinned"
        id="siteNav"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          opacity: 1,
          transform: "none",
        }}
      >
        <Link href="/" className="brand nav-mark-word">
          Incognito 5.0
        </Link>
        <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: "26px" }}>
          <Link href="/#the-night" className="nav-cta">
            The Night
          </Link>
          <Link href="/#families" className="nav-cta">
            The Families
          </Link>
          <Link href="/#registrations" className="nav-cta">
            Register
          </Link>
          <Link
            href="/validate-flag"
            className="nav-cta"
            style={{ color: "var(--gold-bright)", borderColor: "rgba(224,181,99,0.3)" }}
          >
            Verify Flag
          </Link>
        </div>
      </nav>

      {/* Main Content Area */}
      <main
        style={{
          minHeight: "100vh",
          paddingTop: "120px",
          paddingBottom: "80px",
          position: "relative",
          zIndex: 10,
        }}
      >
        <div style={{ maxWidth: "680px", margin: "0 auto", padding: "0 20px" }}>
          {/* Simple Clean Header */}
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <h1
              style={{
                fontFamily: "'Godfather', Georgia, serif",
                fontSize: "clamp(2.2rem, 5vw, 3rem)",
                color: "#ffffff",
                letterSpacing: "0.03em",
                margin: "0 0 12px",
              }}
            >
              Verify Flag
            </h1>
            <p
              style={{
                color: "#ded5c0",
                fontSize: "1rem",
                lineHeight: 1.6,
                fontFamily: "system-ui, -apple-system, sans-serif",
                margin: 0,
              }}
            >
              Enter your flag below to verify and receive your event entry ticket.
            </p>
          </div>

          {/* Form Card */}
          {!result || result.status === "error" ? (
            <div
              style={{
                background: "rgba(18, 13, 9, 0.94)",
                border: "1px solid rgba(224, 181, 99, 0.4)",
                borderRadius: "6px",
                padding: "32px 28px",
                boxShadow: "0 20px 50px rgba(0,0,0,0.85)",
                marginBottom: "30px",
              }}
            >
              {/* Error Message Box */}
              {result?.status === "error" && (
                <div
                  style={{
                    background: "rgba(120, 20, 25, 0.35)",
                    border: "1px solid #e53e3e",
                    padding: "14px 18px",
                    marginBottom: "20px",
                    borderRadius: "4px",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                  }}
                >
                  <span style={{ fontSize: "1.2rem", color: "#fc8181" }}>⚠️</span>
                  <div style={{ fontSize: "0.95rem", color: "#f7e8e8" }}>
                    {result.message}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div>
                  <label
                    htmlFor="flagInput"
                    style={{
                      display: "block",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      color: "#ffffff",
                      marginBottom: "8px",
                      fontFamily: "system-ui, -apple-system, sans-serif",
                    }}
                  >
                    Flag
                  </label>
                  <input
                    id="flagInput"
                    type="text"
                    value={flag}
                    onChange={(e) => setFlag(e.target.value)}
                    placeholder="enter your flag here"
                    required
                    disabled={cooldown > 0 || loading}
                    style={{
                      width: "100%",
                      padding: "14px 16px",
                      background: "rgba(5, 3, 2, 0.9)",
                      border: "1px solid rgba(224, 181, 99, 0.5)",
                      color: "#ffffff",
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      fontSize: "1rem",
                      borderRadius: "4px",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={loading || !flag.trim() || cooldown > 0}
                    className="btn-seal"
                    style={{
                      width: "100%",
                      cursor: cooldown > 0 ? "not-allowed" : loading ? "wait" : "pointer",
                      opacity: cooldown > 0 || loading ? 0.75 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "10px",
                      fontSize: "1rem",
                      fontWeight: 700,
                      padding: "16px 24px",
                      borderRadius: "4px",
                    }}
                  >
                    {cooldown > 0 ? `Wait ${cooldown}s` : loading ? "Verifying..." : "Verify Flag"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* TICKET DISPLAY (Shows ticket and download button seamlessly for first submission or resubmission) */
            <div
              style={{
                background: "rgba(16, 12, 8, 0.98)",
                border: "2px solid #e0b563",
                padding: "36px 24px",
                borderRadius: "6px",
                marginBottom: "30px",
                boxShadow: "0 0 45px rgba(224, 181, 99, 0.25)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  padding: "8px 24px",
                  background: "rgba(72, 187, 120, 0.15)",
                  border: "2px solid #48bb78",
                  color: "#48bb78",
                  fontSize: "0.95rem",
                  fontWeight: 800,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  borderRadius: "4px",
                  marginBottom: "16px",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
              >
                ✓ VERIFIED
              </div>

              <h2
                style={{
                  fontFamily: "'Godfather', Georgia, serif",
                  fontSize: "clamp(2rem, 4.5vw, 2.8rem)",
                  color: "#ffffff",
                  margin: "0 0 8px",
                }}
              >
                Entry Ticket
              </h2>
              <p
                style={{
                  color: "#ded5c0",
                  fontSize: "1rem",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  marginBottom: "24px",
                }}
              >
                Here is your official entry ticket for Incognito 5.0.
              </p>

              {/* TICKET IMAGE */}
              {result.ticket_image && (
                <div style={{ textAlign: "center", margin: "0 auto", maxWidth: "420px" }}>
                  <img
                    src={result.ticket_image}
                    alt="Entry Ticket"
                    style={{
                      width: "100%",
                      height: "auto",
                      borderRadius: "6px",
                      boxShadow: "0 18px 45px rgba(0,0,0,0.9)",
                      border: "2px solid rgba(224, 181, 99, 0.5)",
                    }}
                  />
                  <div style={{ marginTop: "20px" }}>
                    <button
                      onClick={handleDownloadImage}
                      className="btn-seal"
                      style={{ padding: "14px 32px", fontSize: "1rem", fontWeight: 700 }}
                    >
                      Download Ticket
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Simple Clean Footer Info */}
          <div
            style={{
              textAlign: "center",
              marginTop: "40px",
              borderTop: "1px solid rgba(184, 146, 63, 0.15)",
              paddingTop: "20px",
              color: "#9e917d",
              fontSize: "0.85rem",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            05 October 2026 &bull; 3-7 PM &bull; Upper Auditorium
          </div>
        </div>
      </main>
    </>
  );
}
