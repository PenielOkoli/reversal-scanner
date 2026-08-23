type Stage = "developing" | "candidate" | "confirmed";

const STAGE_ORDER: Stage[] = ["developing", "candidate", "confirmed"];
const STAGE_LABEL: Record<Stage, string> = {
  developing: "Developing",
  candidate: "Candidate",
  confirmed: "Confirmed",
};

/**
 * The product's signature element: a three-segment meter that shows exactly
 * how far a pattern has progressed, rather than a flat colored pill. The
 * filled segments read left to right as "how much of the case has built up
 * so far," which is the whole point of staging signals instead of only
 * alerting on full confirmation.
 */
export function StageMeter({ stage, direction }: { stage: Stage; direction: "bearish" | "bullish" }) {
  const reachedIndex = STAGE_ORDER.indexOf(stage);
  const finalColor = direction === "bearish" ? "var(--bearish)" : "var(--bullish)";

  return (
    <div className="inline-flex items-center gap-2">
      <div className="flex gap-0.5">
        {STAGE_ORDER.map((s, i) => {
          const filled = i <= reachedIndex;
          const isFinalSegment = i === STAGE_ORDER.length - 1;
          const color = !filled ? "var(--border-subtle)" : isFinalSegment && stage === "confirmed" ? finalColor : "var(--accent)";
          return (
            <span
              key={s}
              className="h-1.5 w-5 rounded-full transition-colors"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          );
        })}
      </div>
      <span className="font-mono text-xs uppercase tracking-wide text-text-muted">
        {STAGE_LABEL[stage]}
      </span>
    </div>
  );
}
