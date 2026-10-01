import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const err = error as Error;
    // Fallback if backend is not running: fallback admin check for local dev
    return NextResponse.json(
      {
        status: "error",
        message: "Failed to connect to authentication server.",
        detail: err.message,
      },
      { status: 502 }
    );
  }
}
