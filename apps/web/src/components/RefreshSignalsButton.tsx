"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshSignalsButton() {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isRefreshing}
      className="rounded-md border border-border-subtle px-2.5 py-1 font-mono text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
      aria-label="Refresh signals"
    >
      {isRefreshing ? "Refreshing..." : "Refresh"}
    </button>
  );
}
