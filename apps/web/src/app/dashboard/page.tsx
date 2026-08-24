import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PairSelector } from "@/components/PairSelector";
import { SignalTable } from "@/components/SignalTable";
import { SignOutButton } from "@/components/SignOutButton";
import { NotificationSettings } from "@/components/NotificationSettings";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: watchlistItems }] = await Promise.all([
    supabase.from("profiles").select("pair_cap, telegram_enabled").eq("id", user.id).maybeSingle(),
    supabase.from("watchlist_items").select("id, symbol, timeframe").order("symbol"),
  ]);

  const items = watchlistItems ?? [];
  const symbols = [...new Set(items.map((i) => i.symbol))];

  const { data: rawSignals } = symbols.length
    ? await supabase
        .from("signals")
        .select("id, symbol, timeframe, pattern_type, stage, confidence, neckline, neckline_broken, updated_at")
        .in("symbol", symbols)
        .order("updated_at", { ascending: false })
    : { data: [] };

  // Signals are per (symbol, timeframe) globally, only show the ones that
  // match a timeframe the user actually selected for that symbol.
  const watchedCombos = new Set(items.map((i) => `${i.symbol}:${i.timeframe}`));
  const signals = (rawSignals ?? []).filter((s) => watchedCombos.has(`${s.symbol}:${s.timeframe}`));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Reversal Scanner</h1>
          <p className="mt-1 text-sm text-text-muted">{user.email}</p>
        </div>
        <SignOutButton />
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-3 font-display text-sm font-semibold tracking-tight text-text-primary">Signals</h2>
          <SignalTable signals={signals} />
        </section>

        <aside>
          <PairSelector initialItems={items} pairCap={profile?.pair_cap ?? 20} />
          <NotificationSettings telegramEnabled={profile?.telegram_enabled ?? false} />
        </aside>
      </div>
    </main>
  );
}
