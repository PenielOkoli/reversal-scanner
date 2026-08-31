"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type WatchlistItem = { id: string; symbol: string };

export function PairSelector({
  initialItems,
  pairCap,
}: {
  initialItems: WatchlistItem[];
  pairCap: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [items, setItems] = useState(initialItems);
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/symbols")
      .then((r) => r.json())
      .then((d) => setAllSymbols(d.symbols ?? []))
      .catch(() => setAllSymbols([]));
  }, []);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.toUpperCase();
    return allSymbols.filter((s) => s.includes(q)).slice(0, 8);
  }, [query, allSymbols]);

  async function addSymbol(symbol: string) {
    setError(null);
    if (items.length >= pairCap) {
      setError(`You're at your ${pairCap}-pair limit. Remove one before adding another.`);
      return;
    }

    setPending(true);
    const { data, error } = await supabase.from("watchlist_items").insert({ symbol }).select("id, symbol").single();
    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }

    setItems((prev) => [...prev, data]);
    setQuery("");
    router.refresh();
  }

  async function removeItem(id: string) {
    setError(null);
    const { error } = await supabase.from("watchlist_items").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold tracking-tight text-text-primary">Watchlist</h2>
        <span className="font-mono text-xs text-text-muted">
          {items.length} / {pairCap} pairs
        </span>
      </div>
      <p className="mb-3 text-xs text-text-muted">
        Every pair is scanned across all four timeframes automatically, no need to pick one.
      </p>

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a pair, e.g. BTCUSDT"
          disabled={pending}
          className="w-full rounded-md border border-border-subtle bg-bg-base px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-accent disabled:opacity-50"
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border-subtle bg-bg-surface-raised shadow-lg">
            {matches.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => addSymbol(s)}
                  className="block w-full px-3 py-2 text-left font-mono text-sm text-text-primary hover:bg-accent/10"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-bearish">{error}</p>}

      {items.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-1.5 font-mono text-sm"
            >
              <span>{item.symbol}</span>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="text-text-muted hover:text-bearish"
                aria-label={`Remove ${item.symbol}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}