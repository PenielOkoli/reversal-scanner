import { StageMeter } from "./StageMeter";

type FundingConfluence = { available: boolean; extreme: boolean; avgRate: number | null };
type OpenInterestTrend = { available: boolean; trend: "building" | "unwinding" | "flat" | "unknown"; changePercent: number | null };

type Signal = {
  id: string;
  symbol: string;
  timeframe: string;
  pattern_type: "double_top" | "double_bottom";
  stage: "developing" | "candidate" | "confirmed";
  confidence: number;
  neckline: number;
  neckline_broken: boolean;
  funding_confluence: FundingConfluence | null;
  open_interest_trend: OpenInterestTrend | null;
  updated_at: string;
};

/**
 * Only surfaces confluence that's actually firing. A signal with flat
 * funding and flat OI shows nothing here rather than "no confluence"
 * noise, so a row with badges is meaningfully stronger than one without,
 * at a glance.
 */
function ConfluenceBadges({ funding, oi }: { funding: FundingConfluence | null; oi: OpenInterestTrend | null }) {
  const showFunding = funding?.available && funding.extreme;
  const showOi = oi?.available && oi.trend === "building";
  if (!showFunding && !showOi) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {showFunding && (
        <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
          Funding {funding!.avgRate !== null ? `${(funding!.avgRate * 100).toFixed(2)}%` : ""}
        </span>
      )}
      {showOi && (
        <span className="inline-flex items-center rounded-full border border-border-subtle bg-bg-surface px-2 py-0.5 font-mono text-[11px] text-text-primary">
          OI building {oi!.changePercent !== null ? `+${oi!.changePercent}%` : ""}
        </span>
      )}
    </div>
  );
}

export function SignalTable({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-subtle p-10 text-center">
        <p className="text-sm text-text-primary">No signals yet.</p>
        <p className="mt-1 text-sm text-text-muted">
          Add a pair and timeframe below, the scanner checks them on its next pass.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle bg-bg-surface text-xs uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-medium">Pair</th>
            <th className="px-4 py-3 font-medium">Pattern</th>
            <th className="px-4 py-3 font-medium">Stage</th>
            <th className="px-4 py-3 font-medium">Neckline</th>
            <th className="px-4 py-3 font-medium text-right">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => {
            const direction = s.pattern_type === "double_top" ? "bearish" : "bullish";
            return (
              <tr key={s.id} className="border-b border-border-subtle last:border-0 hover:bg-bg-surface">
                <td className="px-4 py-3 font-mono">
                  {s.symbol}
                  <span className="ml-2 text-text-muted">{s.timeframe}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={direction === "bearish" ? "text-bearish" : "text-bullish"}>
                    {s.pattern_type === "double_top" ? "Double top" : "Double bottom"}
                  </span>
                  <ConfluenceBadges funding={s.funding_confluence} oi={s.open_interest_trend} />
                </td>
                <td className="px-4 py-3">
                  <StageMeter stage={s.stage} direction={direction} />
                </td>
                <td className="px-4 py-3 font-mono text-text-muted">
                  {s.neckline}
                  {s.neckline_broken && <span className="ml-1.5 text-text-primary">broken</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono">{s.confidence}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
