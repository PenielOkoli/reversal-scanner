const assert = require("assert");
const { analyzeSymbol, getZone } = require("../index");

function sig({
  patternType = "double_top",
  stage = "candidate",
  confidence = 70,
  necklineBroken = false,
  timeframe = "4h",
  firstExtreme = { price: 100 },
  secondExtreme = { price: 99 },
  neckline = 90,
}) {
  return {
    symbol: "BTCUSDT",
    patternType,
    stage,
    confidence,
    necklineBroken,
    timeframe,
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

const dailyLevels = { dailyOpen: 98, previousDayHigh: 100, previousDayLow: 80 };
const options = { marketLevels: dailyLevels };

// 4h establishes the major resistance zone. It is dashboard context only
// until a matching 1h reversal pattern appears inside that zone.
{
  const result = analyzeSymbol({ "4h": [sig({})] }, 98, options);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].alertState, "watch");
  assert.strictEqual(result[0].patternTimeframe, null);
}

// A matching 1h pattern moves the idea to setup. A 15m pattern alone is
// deliberately ignored; speed cannot replace the higher-timeframe pattern.
{
  const result = analyzeSymbol(
    {
      "4h": [sig({})],
      "1h": [sig({ timeframe: "1h", confidence: 75, firstExtreme: { price: 99 }, secondExtreme: { price: 98 }, neckline: 91 })],
      "15m": [sig({ timeframe: "15m", stage: "confirmed", necklineBroken: true, firstExtreme: { price: 97 }, secondExtreme: { price: 96 }, neckline: 92 })],
    },
    97,
    options
  );
  assert.strictEqual(result[0].alertState, "confirmed");
  assert.strictEqual(result[0].patternTimeframe, "1h");
  assert.strictEqual(result[0].confirmationTimeframe, "15m");
  assert.strictEqual(result[0].entryTimeframe, null);
}

// The 5m break is the final execution condition. It cannot trigger without
// the already-confirmed 15m layer and the 1h pattern in the 4h zone.
{
  const result = analyzeSymbol(
    {
      "4h": [sig({ stage: "confirmed", necklineBroken: true })],
      "1h": [sig({ timeframe: "1h", stage: "confirmed", necklineBroken: true, confidence: 75, firstExtreme: { price: 99 }, secondExtreme: { price: 98 }, neckline: 91 })],
      "15m": [sig({ timeframe: "15m", stage: "confirmed", necklineBroken: true, confidence: 80, firstExtreme: { price: 97 }, secondExtreme: { price: 96 }, neckline: 92 })],
      "5m": [sig({ timeframe: "5m", stage: "confirmed", necklineBroken: true, confidence: 85, firstExtreme: { price: 96 }, secondExtreme: { price: 95 }, neckline: 93 })],
    },
    94,
    options
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].alertState, "triggered");
  assert.strictEqual(result[0].entryTimeframe, "5m");
  assert.deepStrictEqual(result[0].dailyLevelConfluence.sort(), ["daily_open", "previous_day_high"]);
}

// A zone without daily-open/PDH confluence is suppressed when daily data is
// available. This makes the scanner more selective than raw M/W matching.
{
  const result = analyzeSymbol({ "4h": [sig({})] }, 98, {
    marketLevels: { dailyOpen: 130, previousDayHigh: 130, previousDayLow: 70 },
  });
  assert.deepStrictEqual(result, []);
}

// Equal-strength bullish and bearish contexts are ambiguity, not two trades.
{
  const result = analyzeSymbol(
    {
      "4h": [
        sig({ patternType: "double_top" }),
        sig({ patternType: "double_bottom", firstExtreme: { price: 90 }, secondExtreme: { price: 91 }, neckline: 100 }),
      ],
    },
    98,
    { marketLevels: { dailyOpen: 98, previousDayHigh: 100, previousDayLow: 90 } }
  );
  assert.deepStrictEqual(result, []);
}

{
  const top = getZone({ firstExtreme: { price: 100 }, secondExtreme: { price: 98 }, neckline: 90 }, true);
  assert.deepStrictEqual(top, { low: 90, high: 100 });
}

console.log("timeframe pipeline tests passed");
