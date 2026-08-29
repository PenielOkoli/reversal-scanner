/**
 * Minimal Bybit v5 REST client for public market data. No API key needed,
 * these are public endpoints. Uses the global fetch built into Node 18+,
 * no HTTP dependency required.
 *
 * Docs: https://bybit-exchange.github.io/docs/v5/market/kline
 */

const BASE_URL = "https://api.bybit.com";

// Maps our timeframe labels to Bybit's interval codes.
const TIMEFRAME_MAP = {
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
};

/**
 * @param {Object} params
 * @param {string} params.symbol     e.g. "BTCUSDT"
 * @param {string} params.timeframe  one of "5m" | "15m" | "1h" | "4h"
 * @param {string} [params.category] "linear" (USDT perpetuals) by default
 * @param {number} [params.limit]    candles to fetch, max 1000 per Bybit
 * @returns {Promise<Array>} chronological (oldest first) OHLCV candles
 */
async function getKlines({ symbol, timeframe, category = "linear", limit = 200 }) {
  const interval = TIMEFRAME_MAP[timeframe];
  if (!interval) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const url = `${BASE_URL}/v5/market/kline?category=${category}&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit kline request failed: HTTP ${res.status}`);

  const body = await res.json();
  if (body.retCode !== 0) throw new Error(`Bybit error ${body.retCode}: ${body.retMsg}`);

  // Bybit returns candles newest-first as [start, open, high, low, close, volume, turnover].
  // Reverse to chronological order and shape into our plain candle format.
  return body.result.list
    .slice()
    .reverse()
    .map((c) => ({
      time: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
    }));
}

/**
 * Returns every actively trading linear (USDT perpetual) symbol, for
 * populating the pair selector.
 */
async function getLinearSymbols() {
  const url = `${BASE_URL}/v5/market/instruments-info?category=linear`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit instruments request failed: HTTP ${res.status}`);

  const body = await res.json();
  if (body.retCode !== 0) throw new Error(`Bybit error ${body.retCode}: ${body.retMsg}`);

  return body.result.list.filter((i) => i.status === "Trading").map((i) => i.symbol);
}

/**
 * Recent funding rate history for a symbol. Bybit settles funding every
 * 8h on most linear perps, so a handful of periods is enough to see
 * whether longs/shorts have been persistently paying up, not just a
 * single noisy reading.
 *
 * @param {Object} params
 * @param {string} params.symbol
 * @param {string} [params.category] "linear" by default
 * @param {number} [params.limit]    funding periods to fetch, max 200 per Bybit
 * @returns {Promise<Array>} chronological (oldest first) [{ time, fundingRate }]
 *   fundingRate is a fraction, e.g. 0.0001 = 0.01%
 */
async function getFundingRateHistory({ symbol, category = "linear", limit = 3 }) {
  const url = `${BASE_URL}/v5/market/funding/history?category=${category}&symbol=${symbol}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit funding history request failed: HTTP ${res.status}`);

  const body = await res.json();
  if (body.retCode !== 0) throw new Error(`Bybit error ${body.retCode}: ${body.retMsg}`);

  return body.result.list
    .slice()
    .reverse()
    .map((f) => ({
      time: Number(f.fundingRateTimestamp),
      fundingRate: Number(f.fundingRate),
    }));
}

/**
 * Recent open interest history for a symbol, used to see whether
 * positioning is building or unwinding across a pattern's formation
 * window. Independent of chart timeframe, this is exchange-wide OI.
 *
 * @param {Object} params
 * @param {string} params.symbol
 * @param {string} [params.category]     "linear" by default
 * @param {string} [params.intervalTime] "5min" | "15min" | "30min" | "1h" | "4h" | "1d"
 * @param {number} [params.limit]        snapshots to fetch, max 200 per Bybit
 * @returns {Promise<Array>} chronological (oldest first) [{ time, openInterest }]
 */
async function getOpenInterest({ symbol, category = "linear", intervalTime = "1h", limit = 200 }) {
  const url = `${BASE_URL}/v5/market/open-interest?category=${category}&symbol=${symbol}&intervalTime=${intervalTime}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit open interest request failed: HTTP ${res.status}`);

  const body = await res.json();
  if (body.retCode !== 0) throw new Error(`Bybit error ${body.retCode}: ${body.retMsg}`);

  return body.result.list
    .slice()
    .reverse()
    .map((o) => ({
      time: Number(o.timestamp),
      openInterest: Number(o.openInterest),
    }));
}

module.exports = {
  getKlines,
  getLinearSymbols,
  getFundingRateHistory,
  getOpenInterest,
  TIMEFRAME_MAP,
  BASE_URL,
};
