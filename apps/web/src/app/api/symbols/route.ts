import { NextResponse } from "next/server";
import { getLinearSymbols } from "@reversal-scanner/bybit-client";

// Cached for a day, the tradeable symbol list doesn't change often enough
// to justify hitting Bybit on every keystroke in the pair selector.
export const revalidate = 86400;

export async function GET() {
  try {
    const symbols = await getLinearSymbols();
    return NextResponse.json({ symbols });
  } catch (err) {
    return NextResponse.json(
      { symbols: [], error: err instanceof Error ? err.message : "Failed to load symbols" },
      { status: 502 }
    );
  }
}
