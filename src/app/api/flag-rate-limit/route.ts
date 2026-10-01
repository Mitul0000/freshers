import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    const res = await fetch(`${BACKEND_URL}/api/flag-rate-limit`, {
      method: "GET",
      headers: {
        "X-Forwarded-For": clientIp,
        "X-Real-IP": clientIp,
      },
      cache: "no-store",
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ limited: false, error: err.message }, { status: 200 });
  }
}
