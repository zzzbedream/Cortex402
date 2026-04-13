import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export async function GET() {
  if (!API_URL) {
    return NextResponse.json(
      { status: "error", message: "API_URL not configured" },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { status: "offline", upstream_status: res.status },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      vps: data,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "offline",
        message: err instanceof Error ? err.message : "VPS unreachable",
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}
