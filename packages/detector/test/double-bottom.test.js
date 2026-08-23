const assert = require("assert");
const { scanForPatterns } = require("../index");

function candle(i, low, volume) {
  return { time: i, open: low + 2, high: low + 3, low, close: low + 1, volume };
}

// Mirror of the double-top case: decline -> first low (50) -> bounce ->
// second low (51, within tolerance, weaker volume) -> neckline break up.
const lows = [
  99, 96, 92, 88, 84, 80, 76, 72, 68, 64,
  50,
  55, 60, 63, 65, 66,
  64, 61, 58, 56, 54, 53,
  51,
  53, 55, 57, 59, 61,
  64, 68, 72, 76, 80,
];
const volumes = lows.map((_, i) => (i >= 8 && i <= 10 ? 1000 : i >= 20 && i <= 22 ? 500 : 800));
const series = lows.map((l, i) => candle(i, l, volumes[i]));

const signals = scanForPatterns(series, { symbol: "ETHUSDT", timeframe: "1h" });
assert.strictEqual(signals.length, 1, "expected exactly one double bottom");
assert.strictEqual(signals[0].patternType, "double_bottom");
assert.strictEqual(signals[0].stage, "confirmed");
assert.strictEqual(signals[0].necklineBroken, true);

console.log("double-bottom tests passed");
