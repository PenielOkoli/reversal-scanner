const assert = require("assert");
const { analyzeSymbol } = require("../index");

function signal({
  patternType = "double_top",
  timeframe = "4h",
  stage = "candidate",
  confidence = 70,
  necklineBroken = false,
  firstExtreme = { price: 100 },
  secondExtreme = { price: 99 },
  neckline = 90,
}) {
  return {
    symbol: "BTCUSDT",
    patternType,
    timeframe,
    stage,
    confidence,
    necklineBroken,
    firstExtreme,
    secondExtreme,
    neckline,
    distancePercent: 1,
    barsApart: 10,
    rsiDivergence: false,
    volumeTrend: "flat",
    fundingConfluence: null,
    openInterestTrend: null,
    detectedAt: 1,
  };
}

// A valid double-top zone is a watch only while price remains close enough
// to it. This prevents a remote historical level from being presented as a
// current bearish call.
{
  const result = analyzeSymbol({ "4h": [signal({})] }, 98);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].alertState, "watch");
  assert.strictEqual(result[0].triggerPrice, 90);
  assert.strictEqual(result[0].invalidationPrice, 100.3);
  assert.strictEqual(result[0].targetPrice, 80);
}

// Price far beyond the support/resistance zone expires the idea entirely.
{
  const result = analyzeSymbol({ "4h": [signal({})] }, 130);
  assert.deepStrictEqual(result, []);
}

// The execution alert is only produced after the complete sequence: a 4h
// context zone, a 1h pattern, a 15m structural confirmation, then a 5m
// execution break. It cannot be chased far past its neckline.
{
  const result = analyzeSymbol(
    {
      "4h": [signal({ stage: "confirmed", necklineBroken: true })],
      "1h": [signal({ timeframe: "1h", stage: "confirmed", confidence: 75, necklineBroken: true, firstExtreme: { price: 99 }, secondExtreme: { price: 98 }, neckline: 91 })],
      "15m": [signal({ timeframe: "15m", stage: "confirmed", confidence: 78, necklineBroken: true, firstExtreme: { price: 98 }, secondExtreme: { price: 97 }, neckline: 92 })],
      "5m": [signal({ timeframe: "5m", stage: "confirmed", confidence: 80, necklineBroken: true, firstExtreme: { price: 97 }, secondExtreme: { price: 96 }, neckline: 93 })],
    },
    92
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].alertState, "triggered");
  assert.strictEqual(result[0].entryTimeframe, "5m");
}

// Once price runs too far beyond a confirmed breakout, the alert expires
// rather than encouraging a late entry.
{
  const result = analyzeSymbol(
    {
      "4h": [signal({ stage: "confirmed", necklineBroken: true })],
      "1h": [signal({ timeframe: "1h", stage: "confirmed", confidence: 75, necklineBroken: true, firstExtreme: { price: 99 }, secondExtreme: { price: 98 }, neckline: 91 })],
      "15m": [signal({ timeframe: "15m", stage: "confirmed", confidence: 78, necklineBroken: true, firstExtreme: { price: 98 }, secondExtreme: { price: 97 }, neckline: 92 })],
      "5m": [signal({ timeframe: "5m", stage: "confirmed", confidence: 80, necklineBroken: true, firstExtreme: { price: 97 }, secondExtreme: { price: 96 }, neckline: 93 })],
    },
    88
  );
  assert.deepStrictEqual(result, []);
}

// Equal-strength bullish and bearish interpretations are ambiguity. The
// scanner remains silent instead of sending contradictory trade messages.
{
  const result = analyzeSymbol(
    {
      "4h": [
        signal({ patternType: "double_top" }),
        signal({ patternType: "double_bottom", firstExtreme: { price: 90 }, secondExtreme: { price: 91 }, neckline: 100 }),
      ],
    },
    98
  );
  assert.deepStrictEqual(result, []);
}

console.log("price-aware alert tests passed");
