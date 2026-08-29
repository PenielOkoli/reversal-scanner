const { scanForPatterns } = require("@reversal-scanner/detector");
const { getKlines, getFundingRateHistory, getOpenInterest } = require("@reversal-scanner/bybit-client");
const {
  getActiveWatchlistCombos,
  getSubscribersFor,
  saveSignal,
  hasBeenDelivered,
  markDelivered,
} = require("./db");
const { sendTelegramSignal } = require("./notify/telegram");
const { sendPushSignal } = require("./notify/push");

/**
 * Funding rate and open interest are per-symbol, not per-timeframe, but
 * the same symbol shows up once per selected timeframe in the combo list
 * (a user watching BTCUSDT on 4h/1h/15m all counts as three combos). Cache
 * per pass so each symbol only costs two extra Bybit calls total, not one
 * per timeframe.
 */
async function getConfluence(symbol, cache) {
  if (cache.has(symbol)) return cache.get(symbol);

  let confluence = {};
  try {
    const [fundingRates, openInterest] = await Promise.all([
      getFundingRateHistory({ symbol, limit: 3 }),
      getOpenInterest({ symbol, intervalTime: "1h", limit: 200 }),
    ]);
    confluence = { fundingRates, openInterest };
  } catch (err) {
    console.error(`Failed to fetch funding/OI for ${symbol}:`, err.message);
    // Missing confluence data shouldn't block the scan, the detector treats
    // it as unavailable and just skips those two factors for this symbol.
  }
  cache.set(symbol, confluence);
  return confluence;
}

/**
 * One scan pass: union of every selected (symbol, timeframe) across every
 * user, fetched and scanned once, results fanned out to whoever's
 * subscribed and hasn't already been notified at this stage. Keeps Bybit
 * API usage flat as users are added, instead of one fetch per user per pair.
 */
async function runScanPass() {
  const combos = await getActiveWatchlistCombos();
  const confluenceCache = new Map();

  for (const { symbol, timeframe } of combos) {
    let candles;
    try {
      candles = await getKlines({ symbol, timeframe });
    } catch (err) {
      console.error(`Failed to fetch ${symbol} ${timeframe}:`, err.message);
      continue;
    }

    const confluence = await getConfluence(symbol, confluenceCache);
    const signals = scanForPatterns(candles, { symbol, timeframe }, {}, confluence);
    for (const signal of signals) {
      const { signalId } = await saveSignal(signal);
      const subscribers = await getSubscribersFor(symbol, timeframe);

      for (const sub of subscribers) {
        const already = await hasBeenDelivered(signalId, sub.userId, signal.stage);
        if (already) continue;

        if (sub.telegramChatId) await sendTelegramSignal(sub.telegramChatId, signal).catch(console.error);
        if (sub.pushSubscription) await sendPushSignal(sub.pushSubscription, signal).catch(console.error);

        await markDelivered(signalId, sub.userId, signal.stage);
      }
    }
  }
}

module.exports = { runScanPass };
