function formatPrice(value) {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 8,
  });
}

function directionFor(signal) {
  return signal.patternType === "double_top" ? "bearish" : "bullish";
}

function contextPrice(signal) {
  return signal.patternType === "double_top" ? signal.zoneHigh : signal.zoneLow;
}

function contextLabel(signal) {
  return signal.patternType === "double_top" ? "resistance" : "support";
}

function patternLabel(signal) {
  return signal.patternType.replace("_", " ");
}

function triggerText(signal) {
  return signal.patternType === "double_top"
    ? `close below ${formatPrice(signal.triggerPrice)}`
    : `close above ${formatPrice(signal.triggerPrice)}`;
}

function invalidationText(signal) {
  return signal.patternType === "double_top"
    ? `close above ${formatPrice(signal.invalidationPrice)}`
    : `close below ${formatPrice(signal.invalidationPrice)}`;
}

function alertHeading(signal) {
  const direction = directionFor(signal).toUpperCase();
  if (signal.alertState === "triggered") return `${direction} EXECUTION`;
  if (signal.alertState === "confirmed") return `${direction} CONFIRMED`;
  if (signal.alertState === "setup") return `EARLY ${direction} SETUP`;
  return `${direction} WATCH`;
}

function dailyConfluenceText(signal) {
  const levelDetails = {
    daily_open: ["Daily open", signal.dailyOpen],
    previous_day_high: ["PDH", signal.previousDayHigh],
    previous_day_low: ["PDL", signal.previousDayLow],
  };
  const matches = (signal.dailyLevelConfluence || [])
    .map((level) => levelDetails[level])
    .filter(Boolean)
    .map(([label, price]) => `${label} ${formatPrice(price)}`);

  return matches.length ? `Daily confluence: ${matches.join(" + ")}` : "Daily confluence: unavailable";
}

function nextStep(signal) {
  const direction = directionFor(signal);
  if (signal.alertState === "triggered") {
    return "5m execution is live. Manage risk at the invalidation level.";
  }
  if (signal.alertState === "confirmed") {
    return "No trade yet. The 15m structure has confirmed; wait for a 5m execution trigger.";
  }
  if (signal.alertState === "setup") {
    return `No trade yet. Wait for a 15m ${direction} reversal and a close beyond its neckline; then wait for a 5m execution trigger.`;
  }
  return "No trade yet. Wait for a 1h reversal pattern at the 4h context.";
}

function formatSignalMessage(signal) {
  const hasOneHourPattern = signal.patternTimeframe || signal.alertState !== "watch";
  const contextLine = `${signal.timeframe || "4h"} ${contextLabel(signal)} context near ${formatPrice(contextPrice(signal))}`;
  const patternLine = hasOneHourPattern
    ? `1h ${patternLabel(signal)} established`
    : "Waiting for a 1h reversal pattern";
  const lines = [
    `${signal.symbol} | ${alertHeading(signal)}`,
    `${contextLine} | ${patternLine}`,
    `Current: ${formatPrice(signal.currentPrice)}`,
    nextStep(signal),
    dailyConfluenceText(signal),
  ];

  if (signal.alertState === "triggered") {
    lines.push(
      `Execution plan: ${triggerText(signal)} | Invalidation: ${invalidationText(signal)} | Target reference: ${formatPrice(signal.targetPrice)}`
    );
  }

  return lines.join("\n\n");
}

function formatDigestMessage(signals) {
  const header = signals.length === 1 ? "1 signal update" : `${signals.length} signal updates`;
  const lines = signals.map((signal) => {
    const stage = signal.alertState === "triggered"
      ? "5m execution live"
      : signal.alertState === "confirmed"
        ? "15m confirmed; wait for 5m"
        : "1h setup; wait for 15m";
    return `[${alertHeading(signal)}] ${signal.symbol} | ${signal.timeframe || "4h"} ${contextLabel(signal)} near ${formatPrice(contextPrice(signal))} | ${stage}`;
  });
  return [header, "", ...lines].join("\n");
}

module.exports = { formatSignalMessage, formatDigestMessage };
