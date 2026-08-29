const assert = require("assert");
const {
  scanForPatterns,
  evaluateFundingConfluence,
  evaluateOpenInterestTrend,
} = require("../index");

// ---------- Standalone evaluator checks ----------

const extremeLongFunding = [
  { time: 1, fundingRate: 0.0007 },
  { time: 2, fundingRate: 0.0006 },
  { time: 3, fundingRate: 0.0008 },
];
const flatFunding = [
  { time: 1, fundingRate: 0.0001 },
  { time: 2, fundingRate: -0.0001 },
  { time: 3, fundingRate: 0.0002 },
];

assert.strictEqual(
  evaluateFundingConfluence(extremeLongFunding, true, 0.0005).extreme,
  true,
  "persistently positive funding should count as extreme confluence for a double top"
);
assert.strictEqual(
  evaluateFundingConfluence(extremeLongFunding, false, 0.0005).extreme,
  false,
  "positive funding should NOT count as confluence for a double bottom"
);
assert.strictEqual(
  evaluateFundingConfluence(flatFunding, true, 0.0005).extreme,
  false,
  "flat/mixed funding should not trigger extreme confluence"
);
assert.deepStrictEqual(evaluateFundingConfluence([], true, 0.0005), {
  available: false,
  extreme: false,
  avgRate: null,
});

const buildingOI = [
  { time: 0, openInterest: 1000 },
  { time: 5, openInterest: 1050 },
  { time: 10, openInterest: 1200 },
];
const flatOI = [
  { time: 0, openInterest: 1000 },
  { time: 5, openInterest: 1010 },
  { time: 10, openInterest: 990 },
];

assert.strictEqual(
  evaluateOpenInterestTrend(buildingOI, 0, 10).trend,
  "building",
  "10%+ OI growth across the window should read as building"
);
assert.strictEqual(
  evaluateOpenInterestTrend(flatOI, 0, 10).trend,
  "flat",
  "sub-10% OI change should read as flat"
);
assert.strictEqual(
  evaluateOpenInterestTrend([], 0, 10).available,
  false,
  "empty OI series should report unavailable, not throw"
);

// ---------- Wired through scanForPatterns ----------
// Same still-forming double top as double-top.test.js (truncated before the
// neckline break), but here it has no RSI divergence or volume match yet -
// on its own it would sit at "developing". Confirms funding/OI confluence
// alone is enough to promote it to "candidate", and that confidence goes up
// accordingly.

function candle(i, high, volume) {
  return { time: i, open: high - 2, high, low: high - 3, close: high - 1, volume: volume || 800 };
}

const flatVolumeHighs = [
  101, 104, 108, 112, 116, 120, 124, 128, 132, 136,
  150,
  145, 140, 137, 135, 134,
  136, 139, 142, 144, 146, 147,
  149,
];
const flatVolumeSeries = flatVolumeHighs.map((h, i) => candle(i, h));

const baseline = scanForPatterns(flatVolumeSeries, { symbol: "BTCUSDT", timeframe: "1h" });
assert.strictEqual(baseline.length, 1);
assert.strictEqual(baseline[0].stage, "developing", "no confluence data supplied yet, should still be developing");

const withFunding = scanForPatterns(
  flatVolumeSeries,
  { symbol: "BTCUSDT", timeframe: "1h" },
  {},
  { fundingRates: extremeLongFunding, openInterest: [] }
);
assert.strictEqual(withFunding.length, 1);
assert.strictEqual(withFunding[0].fundingConfluence.extreme, true);
assert.strictEqual(withFunding[0].stage, "candidate", "extreme funding alone should promote developing -> candidate");
assert.ok(
  withFunding[0].confidence > baseline[0].confidence,
  "confidence should be higher with confluence confirming than without"
);

console.log("confluence tests passed");
