import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * Proxy endpoint for the live demo.
 * Accepts POST with { action: "intent" | "verify", ... } and forwards
 * to the VPS middleware. This avoids CORS issues when the landing page
 * calls the middleware from the browser.
 */
export async function POST(req: NextRequest) {
  if (!API_URL) {
    return NextResponse.json(
      { error: "API_URL not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { action, ...params } = body;

    let url: string;
    switch (action) {
      case "intent":
        url = `${API_URL}/payment/intent`;
        break;
      case "verify":
        url = `${API_URL}/payment/verify`;
        break;
      default:
        return NextResponse.json(
          { error: "Invalid action. Use 'intent' or 'verify'." },
          { status: 400 }
        );
    }

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10000),
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proxy error" },
      { status: 502 }
    );
  }
}
