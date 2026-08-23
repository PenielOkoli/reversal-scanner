const assert = require("assert");
const { scanForPatterns } = require("../index");

function candle(i, high, volume) {
  return { time: i, open: high - 2, high, low: high - 3, close: high - 1, volume };
}

// Hand-checked double top: rally -> first peak (150) -> pullback -> second
// peak (149, within tolerance, weaker volume) -> neckline break.
const highs = [
  101, 104, 108, 112, 116, 120, 124, 128, 132, 136,
  150,
  145, 140, 137, 135, 134,
  136, 139, 142, 144, 146, 147,
  149,
  147, 145, 143, 141, 139,
  136, 132, 128, 124, 120,
];
const volumes = highs.map((_, i) => (i >= 8 && i <= 10 ? 1000 : i >= 20 && i <= 22 ? 500 : 800));

const fullSeries = highs.map((h, i) => candle(i, h, volumes[i]));
const truncatedSeries = fullSeries.slice(0, 24); // cut off right after the second peak, before pivot confirmation

const fullSignals = scanForPatterns(fullSeries, { symbol: "BTCUSDT", timeframe: "1h" });
assert.strictEqual(fullSignals.length, 1, "expected exactly one double top on the full series");
assert.strictEqual(fullSignals[0].stage, "confirmed", "full series should confirm (neckline broken)");
assert.strictEqual(fullSignals[0].necklineBroken, true);

const truncSignals = scanForPatterns(truncatedSeries, { symbol: "BTCUSDT", timeframe: "1h" });
assert.strictEqual(truncSignals.length, 1, "expected the still-forming pattern to be caught early");
assert.notStrictEqual(truncSignals[0].stage, "confirmed", "truncated series must not claim confirmation early");

console.log("double-top tests passed");
