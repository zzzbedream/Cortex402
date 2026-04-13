import { NextRequest, NextResponse } from "next/server";

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";
const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVXWR7SDVQDU5KPF5AMDNH2FUAQNQYJ3Q37LWRC";

/**
 * GET /api/trustline?address=G...
 * Returns whether the account has a USDC trustline on Testnet.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (
    !address ||
    address.length !== 56 ||
    !address.startsWith("G") ||
    !/^[A-Z0-9]{56}$/.test(address)
  ) {
    return NextResponse.json(
      { error: "Invalid Stellar address. Must be 56 uppercase alphanumeric characters starting with G." },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${address}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    if (res.status === 404) {
      return NextResponse.json({
        address: `${address.slice(0, 4)}...${address.slice(-4)}`,
        exists: false,
        has_usdc_trustline: false,
      });
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Horizon returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const balances: Array<{
      asset_type: string;
      asset_code?: string;
      asset_issuer?: string;
      balance: string;
    }> = data.balances || [];

    const usdc = balances.find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
    );
    const xlm = balances.find((b) => b.asset_type === "native");

    return NextResponse.json({
      address: `${address.slice(0, 4)}...${address.slice(-4)}`,
      exists: true,
      has_usdc_trustline: !!usdc,
      usdc_balance: usdc?.balance || null,
      xlm_balance: xlm?.balance || null,
      total_trustlines: balances.filter((b) => b.asset_type !== "native")
        .length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Horizon unreachable" },
      { status: 502 }
    );
  }
}
