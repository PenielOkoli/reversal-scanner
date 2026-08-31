type FundingConfluence = { available: boolean; extreme: boolean; avgRate: number | null };
type OpenInterestTrend = { available: boolean; trend: "building" | "unwinding" | "flat" | "unknown"; changePercent: number | null };
type AlertState = "watch" | "setup" | "confirmed" | "triggered";

type Signal = {
  id: string;
  symbol: string;
  timeframe: string;
  pattern_timeframe: string | null;
  confirmation_timeframe: string | null;
  entry_timeframe: string | null;
  zone_low: number;
  zone_high: number;
  alert_state: AlertState;
  current_price: number | null;
  trigger_price: number;
  invalidation_price: number;
  target_price: number;
  distance_to_trigger_percent: number | null;
  daily_open: number | null;
  previous_day_high: number | null;
  previous_day_low: number | null;
  daily_level_confluence: string[] | null;
  pattern_type: "double_top" | "double_bottom";
  confidence: number;
  funding_confluence: FundingConfluence | null;
  open_interest_trend: OpenInterestTrend | null;
  updated_at: string;
  notified_at: string | null;
};

const ALERT_LABEL: Record<AlertState, string> = {
  watch: "Watch",
  setup: "Early setup",
  confirmed: "15m confirmed",
  triggered: "5m execution",
};

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 8,
  });
}

function formatRelativeTime(timestamp: string) {
  const milliseconds = new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) return "recently";

  const seconds = Math.max(0, Math.round((Date.now() - milliseconds) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function AlertStateBadge({ state, direction }: { state: AlertState; direction: "bearish" | "bullish" }) {
  const active = state === "triggered" || state === "confirmed";
  const color = active ? (direction === "bearish" ? "text-bearish" : "text-bullish") : "text-text-muted";
  return (
    <span className={`inline-flex rounded-full border border-border-subtle bg-bg-surface-raised px-2 py-0.5 font-mono text-[11px] uppercase ${color}`}>
      {ALERT_LABEL[state]}
    </span>
  );
}

function ConfluenceBadges({ funding, oi }: { funding: FundingConfluence | null; oi: OpenInterestTrend | null }) {
  const showFunding = funding?.available && funding.extreme;
  const showOi = oi?.available && oi.trend === "building";
  if (!showFunding && !showOi) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {showFunding && (
        <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
          Funding {funding.avgRate !== null ? `${(funding.avgRate * 100).toFixed(2)}%` : "extreme"}
        </span>
      )}
      {showOi && (
        <span className="inline-flex items-center rounded-full border border-border-subtle bg-bg-surface px-2 py-0.5 font-mono text-[11px] text-text-primary">
          OI building {oi.changePercent !== null ? `+${oi.changePercent}%` : ""}
        </span>
      )}
    </div>
  );
}

function nextStepFor(state: AlertState, direction: "bearish" | "bullish") {
  if (state === "triggered") return "5m execution is live. Manage risk at the invalidation level.";
  if (state === "confirmed") return "No trade yet. The 15m structure has confirmed; wait for a 5m execution trigger.";
  if (state === "setup") return `No trade yet. Wait for a 15m ${direction} reversal and a close beyond its neckline; then wait for a 5m execution trigger.`;
  return "No trade yet. Wait for a 1h reversal pattern at the 4h context.";
}

function dailyConfluenceText(signal: Signal) {
  const levelDetails: Record<string, [string, number | null]> = {
    daily_open: ["Daily open", signal.daily_open],
    previous_day_high: ["PDH", signal.previous_day_high],
    previous_day_low: ["PDL", signal.previous_day_low],
  };
  const matches = (signal.daily_level_confluence ?? [])
    .map((level) => levelDetails[level])
    .filter((level): level is [string, number | null] => Boolean(level))
    .map(([label, price]) => `${label} ${formatPrice(price)}`);
  return matches.length ? matches.join(" + ") : "Unavailable";
}

export function SignalTable({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-subtle p-10 text-center">
        <p className="text-sm text-text-primary">No active setups.</p>
        <p className="mt-1 text-sm text-text-muted">The scanner only keeps price-relevant, non-conflicting pattern reads.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {signals.map((signal) => {
        const bearish = signal.pattern_type === "double_top";
        const direction = bearish ? "bearish" : "bullish";
        const directionClass = bearish ? "text-bearish" : "text-bullish";
        const contextPrice = bearish ? signal.zone_high : signal.zone_low;
        const contextLabel = bearish ? "resistance" : "support";
        const isTradeLive = signal.alert_state === "triggered";
        const hasOneHourPattern = Boolean(signal.pattern_timeframe) || signal.alert_state !== "watch";
        const triggerText = `Close ${bearish ? "below" : "above"} ${formatPrice(signal.trigger_price)}`;
        const invalidationText = `Close ${bearish ? "above" : "below"} ${formatPrice(signal.invalidation_price)}`;
        const timestamp = signal.notified_at ?? signal.updated_at;
        const timestampLabel = signal.notified_at ? "Sent" : "Updated";

        return (
          <article key={signal.id} className="rounded-lg border border-border-subtle bg-bg-surface p-4 transition-colors hover:border-text-muted/50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-base font-semibold text-text-primary">{signal.symbol}</h3>
                  <AlertStateBadge state={signal.alert_state} direction={direction} />
                </div>
                <p className={`mt-1 text-sm ${directionClass}`}>{bearish ? "Bearish reversal setup" : "Bullish reversal setup"}</p>
                <p className="mt-1 text-xs text-text-muted">
                  {signal.timeframe} {contextLabel} context near {formatPrice(contextPrice)}
                  {hasOneHourPattern ? ` | 1h ${bearish ? "double top" : "double bottom"} established` : " | awaiting 1h pattern"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-semibold text-text-primary">{signal.confidence}</p>
                <p className="text-[11px] uppercase tracking-wide text-text-muted">setup quality</p>
                <p className="mt-1 text-[11px] text-text-muted" title={timestamp}>
                  {timestampLabel} {formatRelativeTime(timestamp)}
                </p>
              </div>
            </div>

            <p className="mt-3 rounded-md bg-bg-base px-3 py-2 text-sm text-text-primary">
              <span className="font-medium text-accent">Next:</span> {nextStepFor(signal.alert_state, direction)}
            </p>

            <div className="mt-3 grid gap-3 border-y border-border-subtle py-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-text-muted">Current price</p>
                <p className="mt-1 font-mono text-text-primary">{formatPrice(signal.current_price)}</p>
              </div>
              {isTradeLive ? (
                <>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-text-muted">Entry trigger</p>
                    <p className="mt-1 font-mono text-text-primary">{triggerText}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-text-muted">Invalidation</p>
                    <p className="mt-1 font-mono text-text-primary">{invalidationText}</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-text-muted">Trade status</p>
                    <p className="mt-1 font-medium text-text-primary">No trade yet</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-text-muted">Daily confluence</p>
                    <p className="mt-1 text-text-primary">{dailyConfluenceText(signal)}</p>
                  </div>
                </>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
              <span>4h zone</span>
              <span aria-hidden="true">&rarr;</span>
              <span className={hasOneHourPattern ? "text-text-primary" : undefined}>1h pattern</span>
              <span aria-hidden="true">&rarr;</span>
              <span className={signal.confirmation_timeframe ? "text-text-primary" : undefined}>15m confirmation</span>
              <span aria-hidden="true">&rarr;</span>
              <span className={signal.entry_timeframe ? "text-text-primary" : undefined}>5m execution</span>
            </div>

            <details className="mt-3 text-xs text-text-muted">
              <summary className="cursor-pointer select-none hover:text-text-primary">Details</summary>
              <div className="mt-2 grid gap-2 border-t border-border-subtle pt-3 sm:grid-cols-2">
                <p>4h pattern range: <span className="font-mono text-text-primary">{formatPrice(signal.zone_low)} - {formatPrice(signal.zone_high)}</span></p>
                {isTradeLive ? (
                  <>
                    <p>Target reference: <span className="font-mono text-text-primary">{formatPrice(signal.target_price)}</span></p>
                    <p>Distance to trigger: <span className="font-mono text-text-primary">{signal.distance_to_trigger_percent ?? "-"}%</span></p>
                  </>
                ) : (
                  <p>A trade plan appears only after the 5m execution trigger.</p>
                )}
              </div>
              <ConfluenceBadges funding={signal.funding_confluence} oi={signal.open_interest_trend} />
            </details>
          </article>
        );
      })}
    </div>
  );
}
