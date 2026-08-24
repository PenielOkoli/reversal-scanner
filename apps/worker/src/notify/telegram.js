const { bot } = require("../telegram-bot");

function formatSignalMessage(signal) {
  const arrow = signal.patternType === "double_top" ? "🔻" : "🔺";
  const stageLabel = { developing: "🟡 Developing", candidate: "🟠 Candidate", confirmed: "🟢 Confirmed" }[signal.stage];
  return [
    `${arrow} ${signal.symbol} (${signal.timeframe}) - ${signal.patternType.replace("_", " ")}`,
    stageLabel,
    `First: ${signal.firstExtreme.price}  Second: ${signal.secondExtreme.price}  (${signal.distancePercent}% apart)`,
    `Neckline: ${signal.neckline}${signal.necklineBroken ? " (broken)" : ""}`,
    `RSI divergence: ${signal.rsiDivergence ? "yes" : "no"}  Volume: ${signal.volumeTrend}`,
    `Confidence: ${signal.confidence}%`,
  ].join("\n");
}

async function sendTelegramSignal(chatId, signal) {
  await bot.sendMessage(chatId, formatSignalMessage(signal));
}

module.exports = { sendTelegramSignal, formatSignalMessage };
