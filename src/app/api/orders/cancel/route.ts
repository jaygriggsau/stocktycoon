import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { cancelOrder } from "@/lib/trading";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  let body: { orderId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.orderId) return NextResponse.json({ ok: false, error: "Missing orderId" }, { status: 400 });
  const result = await cancelOrder(user.id, Number(body.orderId));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
