"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CancelOrderButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/orders/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        router.refresh();
      }}
      className="text-xs text-ink-muted underline-offset-2 hover:text-loss hover:underline disabled:opacity-40"
    >
      {busy ? "..." : "Cancel"}
    </button>
  );
}
