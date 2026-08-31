const { scanForPatterns, analyzeSymbol } = require("@reversal-scanner/detector");
const {
  getKlines,
  getFundingRateHistory,
  getOpenInterest,
  TIMEFRAME_MAP,
} = require("@reversal-scanner/bybit-client");
const {
  getActiveSymbols,
  getSubscribersFor,
  saveSignal,
  hasBeenDelivered,
  markDelivered,
} = require("./db");
const { sendTelegramDigest } = require("./notify/telegram");
const { sendPushDigest } = require("./notify/push");

const ALL_TIMEFRAMES = Object.keys(TIMEFRAME_MAP); // ["5m", "15m", "1h", "4h"]

/**
 * Funding rate and open interest are symbol-level, not timeframe-level.
 * Cache per pass so each symbol only costs two extra Bybit calls total,
 * shared across all four timeframe scans for that symbol.
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
 * Scans every timeframe for one symbol and runs the bias+entry analysis
 * (see detector's analyzeSymbol). Users no longer pick a timeframe,
 * watching a symbol means watching all of them.
 */
async function scanSymbol(symbol, confluenceCache) {
  const confluence = await getConfluence(symbol, confluenceCache);
  const signalsByTimeframe = {};

  for (const timeframe of ALL_TIMEFRAMES) {
    try {
      const candles = await getKlines({ symbol, timeframe });
      signalsByTimeframe[timeframe] = scanForPatterns(candles, { symbol, timeframe }, {}, confluence);
    } catch (err) {
      console.error(`Failed to fetch ${symbol} ${timeframe}:`, err.message);
      // Missing one timeframe shouldn't block combining the others.
    }
  }

  return analyzeSymbol(signalsByTimeframe);
}

/**
 * One scan pass: union of every watched symbol across every user, each
 * scanned across all four timeframes and combined into its best signal per
 * direction, results fanned out to whoever's subscribed. Notifications for
 * everything a user is newly due to hear about in this pass are collected
 * and sent as a single digest per channel, not one message per signal, so
 * a pass that turns up several updates at once doesn't flood anyone.
 */
async function runScanPass() {
  const symbols = await getActiveSymbols();
  const confluenceCache = new Map();
  const pendingByUser = new Map(); // userId -> { telegramChatId, pushSubscription, signals: [] }

  function queue(sub, signal) {
    let entry = pendingByUser.get(sub.userId);
    if (!entry) {
      entry = { telegramChatId: sub.telegramChatId, pushSubscription: sub.pushSubscription, signals: [] };
      pendingByUser.set(sub.userId, entry);
    }
    entry.signals.push(signal);
  }

  for (const symbol of symbols) {
    const signals = await scanSymbol(symbol, confluenceCache);

    for (const signal of signals) {
      const { signalId } = await saveSignal(signal);
      const subscribers = await getSubscribersFor(symbol);

      for (const sub of subscribers) {
        const already = await hasBeenDelivered(signalId, sub.userId, signal.stage);
        if (already) continue;

        queue(sub, signal);
        await markDelivered(signalId, sub.userId, signal.stage);
      }
    }
  }

  for (const { telegramChatId, pushSubscription, signals } of pendingByUser.values()) {
    if (telegramChatId) await sendTelegramDigest(telegramChatId, signals).catch(console.error);
    if (pushSubscription) await sendPushDigest(pushSubscription, signals).catch(console.error);
  }
}

module.exports = { runScanPass };