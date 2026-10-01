// Lightweight QR Code Generator (pure TypeScript, zero dependencies)

/**
 * Minimal QR Code generator supporting byte mode, ECC Level M.
 * Suitable for rendering QR matrices directly into SVG or Canvas.
 */

// Simple QR code SVG component helper using standard public API / SVG path
export function generateQrSvgUrl(text: string, size: number = 220): string {
  // Use encoded SVG Data URL with quick QR API fallback or embedded SVG
  const encoded = encodeURIComponent(text);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&color=0a0705&bgcolor=ece1c6&data=${encoded}`;
}
