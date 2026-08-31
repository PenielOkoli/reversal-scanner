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

function roundPrice(price) {
  return Number(price.toFixed(8));
}

function hasPrecedingTrend(candles, first, isTop, cfg) {
  const referenceIndex = Math.max(0, first.index - cfg.priorTrendBars);
  const referenceClose = candles[referenceIndex]?.close;
  if (!Number.isFinite(referenceClose) || referenceClose <= 0) return false;

  const requiredMove = cfg.minPriorTrendPct / 100;
  return isTop
    ? first.price >= referenceClose * (1 + requiredMove)
    : first.price <= referenceClose * (1 - requiredMove);
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
  priorTrendBars: 10,
  minPriorTrendPct: 3,
  minPatternHeightPct: 1,
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
    if (!hasPrecedingTrend(candles, first, isTop, cfg)) continue;

    // Confirmed second extreme -> Candidate or Confirmed.
    for (let b = a + 1; b < swingPoints.length; b++) {
      const second = swingPoints[b];
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

  const extremePrice = isTop
    ? Math.max(first.price, second.price)
    : Math.min(first.price, second.price);
  const patternHeight = Math.abs(extremePrice - neckline);
  const patternHeightPercent = (patternHeight / neckline) * 100;
  if (patternHeightPercent < cfg.minPatternHeightPct) return null;

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
    patternHeight: roundPrice(patternHeight),
    patternHeightPercent: Number(patternHeightPercent.toFixed(2)),
    neckline: Number(neckline.toFixed(8)),
    necklineBroken,
    confidence,
    detectedAt: candles[candles.length - 1].time,
  };
}

// ---------- Bias + entry multi-timeframe analysis ----------

const CONTEXT_TIMEFRAME = "4h";
const PATTERN_TIMEFRAME = "1h";
const CONFIRMATION_TIMEFRAME = "15m";
const EXECUTION_TIMEFRAME = "5m";
const STAGE_RANK = { developing: 0, candidate: 1, confirmed: 2 };
const ALERT_STATE_RANK = { watch: 0, setup: 1, confirmed: 2, triggered: 3 };
const ANALYSIS_DEFAULTS = {
  zoneTolerancePct: 3,
  maxBreakoutChasePct: 1.5,
  invalidationBufferPct: 0.3,
  dailyLevelTolerancePct: 0.5,
  requireDailyLevelConfluence: true,
};

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

function getActionLevels(signal, isTop, invalidationBufferPct) {
  const zone = getZone(signal, isTop);
  const height = Math.abs(zone.high - zone.low);
  const buffer = invalidationBufferPct / 100;

  return {
    triggerPrice: roundPrice(signal.neckline),
    invalidationPrice: roundPrice(isTop ? zone.high * (1 + buffer) : zone.low * (1 - buffer)),
    targetPrice: roundPrice(isTop ? signal.neckline - height : signal.neckline + height),
  };
}

function isPriceRelevant(signal, currentPrice, isTop, cfg) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return true;

  const zone = getZone(signal, isTop);
  const zoneTolerance = cfg.zoneTolerancePct / 100;
  const lowerBound = zone.low * (1 - zoneTolerance);
  const upperBound = zone.high * (1 + zoneTolerance);
  if (currentPrice < lowerBound || currentPrice > upperBound) return false;

  if (!signal.necklineBroken) return true;

  const breakoutDistancePct = isTop
    ? ((signal.neckline - currentPrice) / signal.neckline) * 100
    : ((currentPrice - signal.neckline) / signal.neckline) * 100;
  return breakoutDistancePct <= cfg.maxBreakoutChasePct;
}

function zonesOverlap(firstZone, secondZone, tolerancePct) {
  const tolerance = tolerancePct / 100;
  return firstZone.high >= secondZone.low * (1 - tolerance) && firstZone.low <= secondZone.high * (1 + tolerance);
}

function levelTouchesZone(level, zone, tolerancePct) {
  if (!Number.isFinite(level)) return false;
  const tolerance = tolerancePct / 100;
  return level >= zone.low * (1 - tolerance) && level <= zone.high * (1 + tolerance);
}

function getDailyLevelConfluence(zone, isTop, marketLevels, cfg) {
  if (!marketLevels) return [];
  const matchingLevels = [];
  if (levelTouchesZone(marketLevels.dailyOpen, zone, cfg.dailyLevelTolerancePct)) matchingLevels.push("daily_open");
  if (isTop && levelTouchesZone(marketLevels.previousDayHigh, zone, cfg.dailyLevelTolerancePct)) matchingLevels.push("previous_day_high");
  if (!isTop && levelTouchesZone(marketLevels.previousDayLow, zone, cfg.dailyLevelTolerancePct)) matchingLevels.push("previous_day_low");
  return matchingLevels;
}

function selectBestSignal(signals) {
  if (!signals.length) return null;
  return signals.reduce((best, signal) => {
    if (STAGE_RANK[signal.stage] !== STAGE_RANK[best.stage]) {
      return STAGE_RANK[signal.stage] > STAGE_RANK[best.stage] ? signal : best;
    }
    return signal.confidence > best.confidence ? signal : best;
  });
}

/**
 * A strict reversal workflow, rather than a vote across four timeframes:
 *   4h  identifies the major support/resistance zone
 *   1h  must form the matching reversal pattern inside that zone
 *   15m must confirm its neckline break
 *   5m  must then provide the live execution break
 *
 * Daily open and the appropriate previous-day high/low are additional zone
 * filters when market levels are available. A higher timeframe provides
 * context; it does not itself create a trade signal.
 *
 * @param {Object} signalsByTimeframe  { "4h": [...], "1h": [...], "15m": [...], "5m": [...] }
 * @param {number} currentPrice latest price, normally the most recent 5m close
 * @param {Object} opts override ANALYSIS_DEFAULTS
 * @returns {Array} one non-conflicting, price-relevant signal at most
 */
function analyzeSymbol(signalsByTimeframe, currentPrice, opts = {}) {
  const cfg = { ...ANALYSIS_DEFAULTS, ...opts };
  const marketLevels = cfg.marketLevels;
  const results = [];

  for (const patternType of ["double_top", "double_bottom"]) {
    const isTop = patternType === "double_top";
    const context = selectBestSignal((signalsByTimeframe[CONTEXT_TIMEFRAME] || []).filter((signal) => signal.patternType === patternType));
    if (!context || !isPriceRelevant(context, currentPrice, isTop, cfg)) continue;

    const contextZone = getZone(context, isTop);
    const dailyLevelConfluence = getDailyLevelConfluence(contextZone, isTop, marketLevels, cfg);
    if (marketLevels && cfg.requireDailyLevelConfluence && !dailyLevelConfluence.length) continue;

    const aligned = (timeframe, parentZone) => (signalsByTimeframe[timeframe] || []).filter((signal) =>
      signal.patternType === patternType &&
      isPriceRelevant(signal, currentPrice, isTop, cfg) &&
      zonesOverlap(getZone(signal, isTop), parentZone, cfg.zoneTolerancePct)
    );

    const pattern = selectBestSignal(aligned(PATTERN_TIMEFRAME, contextZone));
    const confirmation = pattern
      ? selectBestSignal(aligned(CONFIRMATION_TIMEFRAME, getZone(pattern, isTop)).filter((signal) => signal.necklineBroken))
      : null;
    const execution = confirmation
      ? selectBestSignal(aligned(EXECUTION_TIMEFRAME, getZone(confirmation, isTop)).filter((signal) => signal.necklineBroken))
      : null;

    let stage;
    let confidence;
    let alertState;
    if (execution) {
      stage = "confirmed";
      alertState = "triggered";
      confidence = Math.min(Math.round(context.confidence * 0.25 + pattern.confidence * 0.25 + confirmation.confidence * 0.2 + execution.confidence * 0.3) + 8, 99);
    } else if (confirmation) {
      stage = "confirmed";
      alertState = "confirmed";
      confidence = Math.min(Math.round(context.confidence * 0.3 + pattern.confidence * 0.35 + confirmation.confidence * 0.35) + 5, 99);
    } else if (pattern) {
      stage = "candidate";
      alertState = "setup";
      confidence = Math.min(Math.round(context.confidence * 0.45 + pattern.confidence * 0.55), 99);
    } else {
      stage = "developing";
      alertState = "watch";
      confidence = context.confidence;
    }

    const base = execution || confirmation || pattern || context;
    const actionLevels = getActionLevels(base, isTop, cfg.invalidationBufferPct);
    results.push({
      symbol: base.symbol,
      patternType,
      stage,
      alertState,
      confidence,
      timeframe: CONTEXT_TIMEFRAME,
      biasStage: context.stage,
      patternTimeframe: pattern ? PATTERN_TIMEFRAME : null,
      confirmationTimeframe: confirmation ? CONFIRMATION_TIMEFRAME : null,
      entryTimeframe: execution ? EXECUTION_TIMEFRAME : null,
      currentPrice: Number.isFinite(currentPrice) ? roundPrice(currentPrice) : null,
      zoneLow: roundPrice(contextZone.low),
      zoneHigh: roundPrice(contextZone.high),
      dailyOpen: Number.isFinite(marketLevels?.dailyOpen) ? roundPrice(marketLevels.dailyOpen) : null,
      previousDayHigh: Number.isFinite(marketLevels?.previousDayHigh) ? roundPrice(marketLevels.previousDayHigh) : null,
      previousDayLow: Number.isFinite(marketLevels?.previousDayLow) ? roundPrice(marketLevels.previousDayLow) : null,
      dailyLevelConfluence,
      ...actionLevels,
      distanceToTriggerPercent: Number.isFinite(currentPrice)
        ? Number((Math.abs(currentPrice - actionLevels.triggerPrice) / actionLevels.triggerPrice * 100).toFixed(2))
        : null,
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

  if (results.length < 2) return results;

  // Opposite reversal hypotheses on the same symbol are ambiguity, not two
  // independent trades. Keep only a clearly more mature setup; otherwise
  // remain silent until price resolves the conflict.
  const [best, runnerUp] = [...results].sort((a, b) => {
    const stateDifference = ALERT_STATE_RANK[b.alertState] - ALERT_STATE_RANK[a.alertState];
    return stateDifference || b.confidence - a.confidence;
  });
  return ALERT_STATE_RANK[best.alertState] > ALERT_STATE_RANK[runnerUp.alertState] ? [best] : [];
}

module.exports = {
  scanForPatterns,
  calculateRSI,
  findSwingPoints,
  evaluateFundingConfluence,
  evaluateOpenInterestTrend,
  analyzeSymbol,
  getZone,
  getActionLevels,
  isPriceRelevant,
};
