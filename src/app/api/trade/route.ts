import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { executeMarketOrder, placeLimitOrder, ensurePlayer } from "@/lib/trading";
import { tick } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  let body: {
    symbol?: string;
    side?: string;
    type?: string;
    shares?: number;
    limitPrice?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { symbol, side, type, shares, limitPrice } = body;
  if (!symbol || (side !== "buy" && side !== "sell") || !shares) {
    return NextResponse.json({ ok: false, error: "Missing symbol, side or shares" }, { status: 400 });
  }

  await tick();
  await ensurePlayer(user.id, user.name);

  const result =
    type === "limit"
      ? await placeLimitOrder(user.id, symbol, side, Math.floor(shares), Number(limitPrice))
      : await executeMarketOrder(user.id, symbol, side, Math.floor(shares));

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
