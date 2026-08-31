const { bot } = require("../telegram-bot");

const DIRECTION_WORD = { double_top: "Bearish", double_bottom: "Bullish" };
const ARROW = { double_top: "🔻", double_bottom: "🔺" };

/**
 * Reads like actual multi-timeframe trading guidance: what the higher
 * timeframe bias is, and separately, what's happening on the lower
 * timeframe where an entry would actually be taken. A raw stat dump
 * ("BTCUSDT (4h +1h,15m,5m) - Confirmed - 99%") tells a trader nothing
 * about what to do, this is meant to.
 */
function formatSignalMessage(signal) {
  const direction = DIRECTION_WORD[signal.patternType];
  const arrow = ARROW[signal.patternType];
  const patternLabel = signal.patternType.replace("_", " ");
  const zoneLabel = signal.patternType === "double_top" ? "resistance zone" : "support zone";
  const zone = `${signal.zoneLow} - ${signal.zoneHigh}`;

  const biasLine = `${arrow} ${signal.symbol} — ${direction} bias on ${signal.timeframe} (${patternLabel}), ${zoneLabel} ${zone}`;

  let entryLine;
  if (signal.stage === "confirmed") {
    entryLine = `Entry trigger: ${signal.entryTimeframe} ${patternLabel} broke neckline right at that zone, at the current price. This is live, not historical.`;
  } else if (signal.stage === "candidate") {
    entryLine = `Entry watch: ${signal.entryTimeframe} showing a ${patternLabel} forming at that same zone, hasn't broken neckline yet.`;
  } else {
    entryLine = `No entry setup yet at the ${zone} zone, watching 15m/5m for one to form there.`;
  }

  return [biasLine, entryLine, `Confidence: ${signal.confidence}%`].join("\n");
}

/**
 * One compact line per signal instead of the full detailed block, so a
 * scan pass that finds several updates at once sends one message a user
 * can skim, not a burst of separate messages landing back to back.
 */
function formatDigestLine(signal) {
  const direction = DIRECTION_WORD[signal.patternType];
  const arrow = ARROW[signal.patternType];
  const entryPart = signal.entryTimeframe
    ? `entry ${signal.entryTimeframe}${signal.stage === "confirmed" ? " (live)" : " (forming)"}`
    : "no entry yet";
  return `${arrow} ${signal.symbol} - ${direction} bias ${signal.timeframe} @ ${signal.zoneLow}-${signal.zoneHigh} - ${entryPart} - ${signal.confidence}%`;
}

function formatDigestMessage(signals) {
  const header = signals.length === 1 ? "1 signal update" : `${signals.length} signal updates`;
  return [header, "", ...signals.map(formatDigestLine)].join("\n");
}

async function sendTelegramSignal(chatId, signal) {
  await bot.sendMessage(chatId, formatSignalMessage(signal));
}

async function sendTelegramDigest(chatId, signals) {
  if (!signals.length) return;
  if (signals.length === 1) return sendTelegramSignal(chatId, signals[0]);
  await bot.sendMessage(chatId, formatDigestMessage(signals));
}

module.exports = { sendTelegramSignal, sendTelegramDigest, formatSignalMessage, formatDigestMessage };