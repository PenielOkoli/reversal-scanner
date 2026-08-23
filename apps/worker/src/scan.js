const { scanForPatterns } = require("@reversal-scanner/detector");
const { getKlines } = require("@reversal-scanner/bybit-client");
const { getActiveWatchlistCombos, getSubscribersFor, saveSignal } = require("./db");
const { sendTelegramSignal } = require("./notify/telegram");
const { sendPushSignal } = require("./notify/push");

/**
 * One scan pass: union of every selected (symbol, timeframe) across every
 * user, fetched and scanned once, results fanned out to whoever's
 * subscribed. This is what keeps Bybit API usage flat as users are added,
 * instead of one fetch per user per pair.
 */
async function runScanPass() {
  const combos = await getActiveWatchlistCombos();

  for (const { symbol, timeframe } of combos) {
    let candles;
    try {
      candles = await getKlines({ symbol, timeframe });
    } catch (err) {
      console.error(`Failed to fetch ${symbol} ${timeframe}:`, err.message);
      continue;
    }

    const signals = scanForPatterns(candles, { symbol, timeframe });
    for (const signal of signals) {
      const isNew = await saveSignal(signal);
      if (!isNew) continue; // only notify on new/changed signals, not every pass

      const subscribers = await getSubscribersFor(symbol, timeframe);
      for (const sub of subscribers) {
        if (sub.telegramChatId) await sendTelegramSignal(sub.telegramChatId, signal).catch(console.error);
        if (sub.pushSubscription) await sendPushSignal(sub.pushSubscription, signal).catch(console.error);
      }
    }
  }
}

module.exports = { runScanPass };
