/**
 * pattern-detector.js
 *
 * Generalized double top / double bottom detection engine.
 * Works on any OHLCV candle series, for any symbol/timeframe, source-agnostic
 * (feed it candles from Bybit, Binance, wherever).
 *
 * No external dependencies.
 *
 * Candle format expected (chronological, oldest first):
 *   { time: <unix ms or iso string>, open, high, low, close, volume }
 *
 * Output: an array of signal objects, one per pattern found, each staged as
 * "developing" | "candidate" | "confirmed" per the spec:
 *   Developing  - first extreme confirmed, second test is currently forming
 *   Candidate   - second extreme confirmed, OR rejection/RSI divergence/
 *                 volume already support a reversal
 *   Confirmed   - neckline has broken and closed
 */

// ---------- RSI ----------

function calculateRSI(candles, period = 14) {
  const rsi = new Array(candles.length).fill(null);
  if (candles.length <= period) return rsi;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ---------- Swing points ----------

/**
 * Confirmed fractal swing points. A point at index i is a swing high if
 * it's strictly higher than `lookback` candles on both sides.
 *
 * Note: a swing point at index i can only be confirmed once `lookback`
 * candles exist after it. That's intentional, it's exactly what
 * separates a "confirmed first extreme" from a "still-developing second
 * test" near the live edge of the series.
 */
function findSwingPoints(candles, lookback = 5) {
  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const left = candles.slice(i - lookback, i);
    const right = candles.slice(i + 1, i + lookback + 1);
    const current = candles[i];

    const isSwingHigh =
      left.every((c) => c.high < current.high) &&
      right.every((c) => c.high < current.high);
    const isSwingLow =
      left.every((c) => c.low > current.low) &&
      right.every((c) => c.low > current.low);

    if (isSwingHigh) swingHighs.push({ index: i, price: current.high, time: current.time });
    if (isSwingLow) swingLows.push({ index: i, price: current.low, time: current.time });
  }

  return { swingHighs, swingLows };
}

// ---------- Helpers ----------

function pctDiff(a, b) {
  return (Math.abs(a - b) / Math.min(a, b)) * 100;
}

function avgVolume(candles, fromIndex, toIndex) {
  const slice = candles.slice(Math.max(0, fromIndex), toIndex + 1);
  if (!slice.length) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

// ---------- Config ----------

const DEFAULTS = {
  swingLookback: 5, // bars each side required to confirm a swing point
  extremeTolerancePct: 2, // how close two extremes must be to count as "double"
  minSeparationBars: 5, // minimum bars between the two extremes
  maxSeparationBars: 120, // maximum bars between the two extremes (avoid pairing ancient peaks)
  rsiPeriod: 14,
  developingProximityPct: 1.5, // how close live price must get to the first extreme to flag "developing"
};

/**
 * Scans a candle series for double top / double bottom setups.
 *
 * @param {Array} candles  chronological OHLCV array, oldest first
 * @param {Object} meta    { symbol, timeframe } - passed straight through onto each signal
 * @param {Object} opts    override any DEFAULTS
 * @returns {Array} signal objects
 */
function scanForPatterns(candles, meta = {}, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (candles.length < cfg.swingLookback * 2 + cfg.minSeparationBars) return [];

  const rsi = calculateRSI(candles, cfg.rsiPeriod);
  const { swingHighs, swingLows } = findSwingPoints(candles, cfg.swingLookback);

  const signals = [];
  signals.push(...scanSide(candles, rsi, swingHighs, "double_top", meta, cfg));
  signals.push(...scanSide(candles, rsi, swingLows, "double_bottom", meta, cfg));

  // Highest-confidence signal per (patternType + first extreme) wins, so a
  // developing setup that later got a confirmed second test doesn't show twice.
  const dedupeKey = (s) => `${s.patternType}:${s.firstExtreme.index}`;
  const best = new Map();
  for (const s of signals) {
    const key = dedupeKey(s);
    if (!best.has(key) || best.get(key).confidence < s.confidence) best.set(key, s);
  }
  return [...best.values()].sort((a, b) => a.firstExtreme.index - b.firstExtreme.index);
}

function scanSide(candles, rsi, swingPoints, patternType, meta, cfg) {
  const isTop = patternType === "double_top";
  const results = [];
  const lastIndex = candles.length - 1;

  for (let a = 0; a < swingPoints.length; a++) {
    const first = swingPoints[a];

    // Confirmed second extreme -> Candidate or Confirmed.
    for (let b = a + 1; b < swingPoints.length; b++) {
      const second = swingPoints[b];
      const barsApart = second.index - first.index;
      if (barsApart < cfg.minSeparationBars) continue;
      if (barsApart > cfg.maxSeparationBars) break;
      if (pctDiff(first.price, second.price) > cfg.extremeTolerancePct) continue;

      const signal = buildSignal({ candles, rsi, first, second, patternType, meta, cfg, secondConfirmed: true });
      if (signal) results.push(signal);
    }

    // No confirmed second swing yet, but live price is currently retesting
    // the first extreme's level -> Developing (or Candidate if divergence/
    // volume already agree).
    const windowStart = Math.min(first.index + cfg.minSeparationBars, lastIndex);
    const recentWindow = candles.slice(windowStart, lastIndex + 1);
    if (recentWindow.length < 2) continue;

    const recentExtremePrice = isTop
      ? Math.max(...recentWindow.map((c) => c.high))
      : Math.min(...recentWindow.map((c) => c.low));
    const recentExtremeCandle = recentWindow.find((c) =>
      isTop ? c.high === recentExtremePrice : c.low === recentExtremePrice
    );
    const recentIndex = candles.indexOf(recentExtremeCandle);

    if (pctDiff(first.price, recentExtremePrice) > cfg.developingProximityPct) continue;
    if (recentIndex - first.index < cfg.minSeparationBars) continue;
    if (results.some((r) => r.secondExtreme.index === recentIndex)) continue;

    const signal = buildSignal({
      candles,
      rsi,
      first,
      second: { index: recentIndex, price: recentExtremePrice, time: recentExtremeCandle.time },
      patternType,
      meta,
      cfg,
      secondConfirmed: false,
    });
    if (signal) results.push(signal);
  }

  return results;
}

function buildSignal({ candles, rsi, first, second, patternType, meta, cfg, secondConfirmed }) {
  const isTop = patternType === "double_top";

  const between = candles.slice(first.index + 1, second.index);
  if (!between.length) return null;

  const neckline = isTop
    ? Math.min(...between.map((c) => c.low))
    : Math.max(...between.map((c) => c.high));

  // Price closeness between the two extremes is already guaranteed by the
  // tolerance check that paired them, so divergence just compares momentum.
  const rsiFirst = rsi[first.index];
  const rsiSecond = rsi[second.index];
  let rsiDivergence = false;
  if (rsiFirst != null && rsiSecond != null) {
    rsiDivergence = isTop ? rsiSecond < rsiFirst : rsiSecond > rsiFirst;
  }

  const volFirst = avgVolume(candles, first.index - 2, first.index);
  const volSecond = avgVolume(candles, second.index - 2, second.index);
  let volumeTrend = "flat";
  if (volFirst > 0) {
    const change = (volSecond - volFirst) / volFirst;
    if (change <= -0.1) volumeTrend = "weakening";
    else if (change >= 0.1) volumeTrend = "increasing";
  }

  const afterSecond = candles.slice(second.index + 1);
  const necklineBroken = afterSecond.some((c) => (isTop ? c.close < neckline : c.close > neckline));

  let stage;
  if (necklineBroken) stage = "confirmed";
  else if (secondConfirmed || rsiDivergence || volumeTrend === (isTop ? "weakening" : "increasing")) {
    stage = "candidate";
  } else {
    stage = "developing";
  }

  // Starting-point confidence heuristic. Tune the weights against the
  // backtester once real accuracy numbers come in, don't ship this as-is.
  let confidence = 40;
  if (secondConfirmed) confidence += 15;
  if (rsiDivergence) confidence += 20;
  if (volumeTrend === (isTop ? "weakening" : "increasing")) confidence += 15;
  if (necklineBroken) confidence += 10;
  confidence = Math.min(confidence, 99);

  return {
    symbol: meta.symbol || null,
    timeframe: meta.timeframe || null,
    patternType,
    stage,
    firstExtreme: first,
    secondExtreme: second,
    distancePercent: Number(pctDiff(first.price, second.price).toFixed(2)),
    barsApart: second.index - first.index,
    rsiDivergence,
    volumeTrend,
    neckline: Number(neckline.toFixed(8)),
    necklineBroken,
    confidence,
    detectedAt: candles[candles.length - 1].time,
  };
}

module.exports = { scanForPatterns, calculateRSI, findSwingPoints };
