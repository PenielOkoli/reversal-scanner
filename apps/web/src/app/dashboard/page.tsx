import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PairSelector } from "@/components/PairSelector";
import { SignalTable } from "@/components/SignalTable";
import { RefreshSignalsButton } from "@/components/RefreshSignalsButton";
import { SignOutButton } from "@/components/SignOutButton";
import { NotificationSettings } from "@/components/NotificationSettings";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: watchlistItems }] = await Promise.all([
    supabase.from("profiles").select("pair_cap, telegram_enabled, push_enabled").eq("id", user.id).maybeSingle(),
    supabase.from("watchlist_items").select("id, symbol").order("symbol"),
  ]);

  const items = watchlistItems ?? [];
  const symbols = items.map((i) => i.symbol);

  const { data: rawSignals } = symbols.length
    ? await supabase
        .from("signals")
        .select(
          "id, symbol, timeframe, pattern_timeframe, confirmation_timeframe, entry_timeframe, zone_low, zone_high, alert_state, current_price, trigger_price, invalidation_price, target_price, distance_to_trigger_percent, daily_open, previous_day_high, previous_day_low, daily_level_confluence, pattern_type, stage, confidence, neckline, neckline_broken, funding_confluence, open_interest_trend, updated_at"
        )
        .in("symbol", symbols)
        .order("updated_at", { ascending: false })
    : { data: [] };

  const signalIds = (rawSignals ?? []).map((signal) => signal.id);
  const { data: deliveries } = signalIds.length
    ? await supabase
        .from("signal_deliveries")
        .select("signal_id, stage_notified, channel, notified_at")
        .in("signal_id", signalIds)
        .in("channel", ["telegram", "push"])
        .order("notified_at", { ascending: false })
    : { data: [] };

  const deliveryBySignalState = new Map<string, string>();
  for (const delivery of deliveries ?? []) {
    const key = `${delivery.signal_id}:${delivery.stage_notified}`;
    if (!deliveryBySignalState.has(key)) deliveryBySignalState.set(key, delivery.notified_at);
  }

  const signals = (rawSignals ?? []).map((signal) => ({
    ...signal,
    notified_at: deliveryBySignalState.get(`${signal.id}:${signal.alert_state}`) ?? null,
  }));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Reversal Scanner</h1>
          <p className="mt-1 text-sm text-text-muted">{user.email}</p>
        </div>
        <SignOutButton />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-sm font-semibold tracking-tight text-text-primary">Signals</h2>
            <RefreshSignalsButton />
          </div>
          <SignalTable signals={signals} />
        </section>

        <aside>
          <PairSelector initialItems={items} pairCap={profile?.pair_cap ?? 20} />
          <NotificationSettings
            telegramEnabled={profile?.telegram_enabled ?? false}
            pushEnabled={profile?.push_enabled ?? false}
          />
        </aside>
      </div>
    </main>
  );
}
