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

const SCAN_TIMEFRAMES = ["4h", "1h", "15m", "5m"];

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
  const latestPrices = {};

  for (const timeframe of SCAN_TIMEFRAMES) {
    try {
      const candles = await getKlines({ symbol, timeframe });
      latestPrices[timeframe] = candles[candles.length - 1]?.close;
      signalsByTimeframe[timeframe] = scanForPatterns(candles, { symbol, timeframe }, {}, confluence);
    } catch (err) {
      console.error(`Failed to fetch ${symbol} ${timeframe}:`, err.message);
      // Missing one timeframe shouldn't block combining the others.
    }
  }

  let marketLevels;
  try {
    const dailyCandles = await getKlines({ symbol, timeframe: "1d", limit: 3 });
    const currentDaily = dailyCandles[dailyCandles.length - 1];
    const previousDaily = dailyCandles[dailyCandles.length - 2];
    if (currentDaily && previousDaily) {
      marketLevels = {
        dailyOpen: currentDaily.open,
        previousDayHigh: previousDaily.high,
        previousDayLow: previousDaily.low,
      };
    }
  } catch (err) {
    console.error(`Failed to fetch daily levels for ${symbol}:`, err.message);
  }

  // Use the freshest candle for price relevance. A 5m close makes stale
  // higher-timeframe zones expire quickly instead of lingering as context.
  const currentPrice = latestPrices["5m"] ?? latestPrices["15m"] ?? latestPrices["1h"] ?? latestPrices["4h"];
  return analyzeSymbol(signalsByTimeframe, currentPrice, { marketLevels });
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
  const pendingByUser = new Map(); // userId -> { telegramChatId, pushSubscription, telegram: [], push: [] }

  function queue(sub, channel, signal, signalId) {
    let entry = pendingByUser.get(sub.userId);
    if (!entry) {
      entry = { telegramChatId: sub.telegramChatId, pushSubscription: sub.pushSubscription, telegram: [], push: [] };
      pendingByUser.set(sub.userId, entry);
    }
    entry[channel].push({ signal, signalId });
  }

  for (const symbol of symbols) {
    const signals = await scanSymbol(symbol, confluenceCache);

    for (const signal of signals) {
      const { signalId } = await saveSignal(signal);
      // A watch is dashboard context, not an interruption. Notify only when
      // a lower-timeframe setup appears or its breakout actually triggers.
      if (signal.alertState === "watch") continue;
      const subscribers = await getSubscribersFor(symbol);

      for (const sub of subscribers) {
        const channels = [
          sub.telegramChatId ? "telegram" : null,
          sub.pushSubscription ? "push" : null,
        ].filter(Boolean);

        for (const channel of channels) {
          const already = await hasBeenDelivered(signalId, sub.userId, signal.alertState, channel);
          if (!already) queue(sub, channel, signal, signalId);
        }
      }
    }
  }

  for (const [userId, pending] of pendingByUser.entries()) {
    async function deliver(channel, send) {
      const entries = pending[channel];
      if (!entries.length) return;

      try {
        await send(entries.map((entry) => entry.signal));
        // Only persist delivery after the provider confirms the send. A
        // failed channel remains eligible for a retry on the next scan pass.
        await Promise.all(entries.map((entry) => markDelivered(entry.signalId, userId, entry.signal.alertState, channel)));
      } catch (err) {
        console.error(`Failed to deliver ${channel} signal update for user ${userId}:`, err.message);
      }
    }

    if (pending.telegramChatId) {
      await deliver("telegram", (signals) => sendTelegramDigest(pending.telegramChatId, signals));
    }
    if (pending.pushSubscription) {
      await deliver("push", (signals) => sendPushDigest(pending.pushSubscription, signals));
    }
  }
}

module.exports = { runScanPass };
