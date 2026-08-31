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

// ---------- Funding rate & open interest confluence ----------

/**
 * Is funding persistently one-sided across recent periods? Crowded longs
 * paying up into a double top, or crowded shorts paying up into a double
 * bottom, is the same "trapped positioning" read this strategy already
 * trades manually, just applied to the pattern instead of a raw pump.
 *
 * @param {Array} fundingRates  chronological [{ time, fundingRate }], fundingRate as a fraction
 * @param {boolean} isTop
 * @param {number} extremeThreshold  e.g. 0.0005 = 0.05%, both directions
 */
function evaluateFundingConfluence(fundingRates, isTop, extremeThreshold) {
  if (!fundingRates || !fundingRates.length) {
    return { available: false, extreme: false, avgRate: null };
  }
  const avgRate = fundingRates.reduce((s, f) => s + f.fundingRate, 0) / fundingRates.length;
  const extreme = isTop ? avgRate >= extremeThreshold : avgRate <= -extremeThreshold;
  return { available: true, extreme, avgRate: Number(avgRate.toFixed(6)) };
}

/**
 * Is open interest building or unwinding across the pattern's formation
 * window? Rising OI into either extreme means fresh positioning is piling
 * into the move, i.e. exactly the crowd that gets squeezed on a reversal,
 * so "building" is confluence-supportive for both double tops and bottoms.
 *
 * @param {Array} openInterest  chronological [{ time, openInterest }]
 * @param {number} fromTime  ms timestamp of the first extreme
 * @param {number} toTime    ms timestamp of the second extreme
 */
function evaluateOpenInterestTrend(openInterest, fromTime, toTime) {
  if (!openInterest || !openInterest.length) {
    return { available: false, trend: "unknown", changePercent: null };
  }
  const window = openInterest.filter((p) => p.time >= fromTime && p.time <= toTime);
  const points = window.length >= 2 ? window : openInterest;
  if (points.length < 2 || !points[0].openInterest) {
    return { available: false, trend: "unknown", changePercent: null };
  }

  const change = (points[points.length - 1].openInterest - points[0].openInterest) / points[0].openInterest;
  let trend = "flat";
  if (change >= 0.1) trend = "building";
  else if (change <= -0.1) trend = "unwinding";
  return { available: true, trend, changePercent: Number((change * 100).toFixed(2)) };
}

// ---------- Config ----------

const DEFAULTS = {
  swingLookback: 5, // bars each side required to confirm a swing point
  extremeTolerancePct: 2, // how close two extremes must be to count as "double"
  minSeparationBars: 5, // minimum bars between the two extremes
  maxSeparationBars: 120, // maximum bars between the two extremes (avoid pairing ancient peaks)
  maxBarsFromNow: 40, // second extreme must be within this many bars of the live edge, a
  // pattern that finished this many candles ago is stale, not a current setup
  rsiPeriod: 14,
  developingProximityPct: 1.5, // how close live price must get to the first extreme to flag "developing"
  fundingExtremeThreshold: 0.0005, // 0.05% avg funding rate, either direction, counts as "crowded"
};

/**
 * Scans a candle series for double top / double bottom setups.
 *
 * @param {Array} candles  chronological OHLCV array, oldest first
 * @param {Object} meta    { symbol, timeframe } - passed straight through onto each signal
 * @param {Object} opts    override any DEFAULTS
 * @param {Object} confluence  optional { fundingRates, openInterest } from bybit-client,
 *   symbol-level data (not timeframe-specific) used to grade signal quality
 * @returns {Array} signal objects
 */
function scanForPatterns(candles, meta = {}, opts = {}, confluence = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (candles.length < cfg.swingLookback * 2 + cfg.minSeparationBars) return [];

  const rsi = calculateRSI(candles, cfg.rsiPeriod);
  const { swingHighs, swingLows } = findSwingPoints(candles, cfg.swingLookback);

  const signals = [];
  signals.push(...scanSide(candles, rsi, swingHighs, "double_top", meta, cfg, confluence));
  signals.push(...scanSide(candles, rsi, swingLows, "double_bottom", meta, cfg, confluence));

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

function scanSide(candles, rsi, swingPoints, patternType, meta, cfg, confluence) {
  const isTop = patternType === "double_top";
  const results = [];
  const lastIndex = candles.length - 1;

  for (let a = 0; a < swingPoints.length; a++) {
    const first = swingPoints[a];

    // Confirmed second extreme -> Candidate or Confirmed.
    for (let b = a + 1; b < swingPoints.length; b++) {
      const barsApart = second.index - first.index;
      if (barsApart < cfg.minSeparationBars) continue;
      if (barsApart > cfg.maxSeparationBars) break;
      if (pctDiff(first.price, second.price) > cfg.extremeTolerancePct) continue;
      if (lastIndex - second.index > cfg.maxBarsFromNow) continue; // stale, not a current setup

      const signal = buildSignal({ candles, rsi, first, second, patternType, meta, cfg, secondConfirmed: true, confluence });
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
      confluence,
    });
    if (signal) results.push(signal);
  }

  return results;
}

function buildSignal({ candles, rsi, first, second, patternType, meta, cfg, secondConfirmed, confluence = {} }) {
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

  // Whether price is CURRENTLY beyond the neckline, not whether it ever
  // was at some point in the past. Checking "ever" is how an old, unrelated
  // double top and an old, unrelated double bottom can both show as
  // "confirmed" at once, price can only be on one side of the market right now.
  const latestClose = candles[candles.length - 1].close;
  const necklineBroken = isTop ? latestClose < neckline : latestClose > neckline;
  
  const fundingConfluence = evaluateFundingConfluence(
    confluence.fundingRates,
    isTop,
    cfg.fundingExtremeThreshold
  );
  const openInterestTrend = evaluateOpenInterestTrend(confluence.openInterest, first.time, second.time);

  const volumeMatch = volumeTrend === (isTop ? "weakening" : "increasing");
  const oiMatch = openInterestTrend.trend === "building";

  let stage;
  if (necklineBroken) stage = "confirmed";
  else if (secondConfirmed || rsiDivergence || volumeMatch || fundingConfluence.extreme || oiMatch) {
    stage = "candidate";
  } else {
    stage = "developing";
  }

  // Starting-point confidence heuristic. Tune the weights against the
  // backtester once real accuracy numbers come in, don't ship this as-is.
  let confidence = 35;
  if (secondConfirmed) confidence += 12;
  if (rsiDivergence) confidence += 15;
  if (volumeMatch) confidence += 12;
  if (necklineBroken) confidence += 8;
  if (fundingConfluence.extreme) confidence += 10;
  if (oiMatch) confidence += 8;
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
    fundingConfluence,
    openInterestTrend,
    neckline: Number(neckline.toFixed(8)),
    necklineBroken,
    confidence,
    detectedAt: candles[candles.length - 1].time,
  };
}

// ---------- Bias + entry multi-timeframe analysis ----------

const BIAS_TIMEFRAMES = ["4h", "1h"];
const ENTRY_TIMEFRAMES = ["15m", "5m"];
const STAGE_RANK = { developing: 0, candidate: 1, confirmed: 2 };
const ZONE_TOLERANCE_PCT = 3; // how far outside the bias's own range an entry can sit and still count

/**
 * The price range a pattern is actually defending: for a top, that's
 * between its neckline and its peak (the supply zone a breakdown would
 * come from); for a bottom, between its trough and its neckline (the
 * demand zone a bounce would come from).
 */
function getZone(signal, isTop) {
  const extremePrice = isTop
    ? Math.max(signal.firstExtreme.price, signal.secondExtreme.price)
    : Math.min(signal.firstExtreme.price, signal.secondExtreme.price);
  return isTop ? { low: signal.neckline, high: extremePrice } : { low: extremePrice, high: signal.neckline };
}

/**
 * Traditional multi-timeframe technical analysis: higher timeframes (4h,
 * 1h) set the overall directional bias, lower timeframes (15m, 5m) are
 * where an actual entry is watched for within that bias, not four
 * independent, equally-weighted votes on the same coin. A "confirmed"
 * pattern on one timeframe and a completely opposite one both showing as
 * fresh and actionable at the same time is exactly the meaningless output
 * this replaces.
 *
 * An entry only counts if it's happening at the same price zone the bias
 * is defending, not just facing the same direction. A 4h double top at
 * $70k and a 15m double top at $50k are both "bearish" but have nothing
 * to do with each other, the higher timeframe holds more weight precisely
 * because it's the level that matters, an entry only means something if
 * it's reacting to that same level.
 *
 * A direction is only surfaced at all if a higher timeframe shows some
 * reading in it, there's no signal without a bias. From there:
 *   - no lower-timeframe reading in the bias's zone yet -> "developing":
 *     bias exists, still watching for an entry to set up there
 *   - a lower-timeframe reading in that zone exists but hasn't broken its
 *     neckline at the current price yet -> "candidate": an entry is forming
 *   - a lower-timeframe reading in that zone HAS broken its neckline at
 *     the current price -> "confirmed": bias and a live entry are aligned
 *     right now, at the level that matters
 *
 * @param {Object} signalsByTimeframe  { "4h": [...], "1h": [...], "15m": [...], "5m": [...] }
 * @returns {Array} up to one signal per pattern type (double_top, double_bottom)
 */
function analyzeSymbol(signalsByTimeframe) {
  const results = [];

  for (const patternType of ["double_top", "double_bottom"]) {
    const isTop = patternType === "double_top";
    const biasCandidates = BIAS_TIMEFRAMES.flatMap((tf) =>
      (signalsByTimeframe[tf] || []).filter((s) => s.patternType === patternType)
    );
    if (!biasCandidates.length) continue; // no higher-timeframe context, nothing to report

    const bias = biasCandidates.reduce((best, s) => {
      if (STAGE_RANK[s.stage] !== STAGE_RANK[best.stage]) {
        return STAGE_RANK[s.stage] > STAGE_RANK[best.stage] ? s : best;
      }
      return s.confidence > best.confidence ? s : best;
    });

    const biasZone = getZone(bias, isTop);
    const tolerance = ZONE_TOLERANCE_PCT / 100;
    const zoneLow = biasZone.low * (1 - tolerance);
    const zoneHigh = biasZone.high * (1 + tolerance);

    const entryCandidates = ENTRY_TIMEFRAMES.flatMap((tf) =>
      (signalsByTimeframe[tf] || []).filter((s) => s.patternType === patternType)
    ).filter((s) => {
      const entryZone = getZone(s, isTop);
      return entryZone.high >= zoneLow && entryZone.low <= zoneHigh; // ranges overlap
    });
    const entry = entryCandidates.length
      ? entryCandidates.reduce((best, s) => (s.confidence > best.confidence ? s : best))
      : null;

    let stage;
    let confidence;
    if (entry && entry.necklineBroken) {
      stage = "confirmed";
      confidence = Math.min(Math.round(bias.confidence * 0.4 + entry.confidence * 0.6) + 10, 99);
    } else if (entry) {
      stage = "candidate";
      confidence = Math.min(Math.round((bias.confidence + entry.confidence) / 2), 99);
    } else {
      stage = "developing";
      confidence = bias.confidence;
    }

    const base = entry || bias;
    results.push({
      symbol: base.symbol,
      patternType,
      stage,
      confidence,
      timeframe: bias.timeframe,
      biasStage: bias.stage,
      entryTimeframe: entry ? entry.timeframe : null,
      zoneLow: Number(biasZone.low.toFixed(8)),
      zoneHigh: Number(biasZone.high.toFixed(8)),
      firstExtreme: base.firstExtreme,
      secondExtreme: base.secondExtreme,
      distancePercent: base.distancePercent,
      barsApart: base.barsApart,
      rsiDivergence: base.rsiDivergence,
      volumeTrend: base.volumeTrend,
      fundingConfluence: base.fundingConfluence,
      openInterestTrend: base.openInterestTrend,
      neckline: base.neckline,
      necklineBroken: base.necklineBroken,
      detectedAt: base.detectedAt,
    });
  }

  return results;
}

module.exports = {
  scanForPatterns,
  calculateRSI,
  findSwingPoints,
  evaluateFundingConfluence,
  evaluateOpenInterestTrend,
  analyzeSymbol,
  getZone,
};