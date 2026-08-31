const assert = require("assert");
const { analyzeSymbol, getZone } = require("../index");

// Default zone: top at [90, 100], bottom at [100, 110]. Override
// firstExtreme/secondExtreme/neckline directly for zone-specific cases.
function sig({
  patternType = "double_top",
  stage,
  confidence,
  necklineBroken = false,
  timeframe = "1h",
  firstExtreme = { price: 100 },
  secondExtreme = { price: 99 },
  neckline = 90,
}) {
  return { patternType, stage, confidence, necklineBroken, symbol: "BTCUSDT", timeframe, firstExtreme, secondExtreme, neckline };
}

// No higher-timeframe reading at all -> nothing gets surfaced, there's no
// signal without a bias, regardless of what a lower timeframe is doing.
{
  const result = analyzeSymbol({
    "15m": [sig({ stage: "confirmed", confidence: 90, necklineBroken: true, timeframe: "15m" })],
  });
  assert.strictEqual(result.length, 0, "an entry-timeframe pattern with no higher-timeframe bias shouldn't surface");
}

// Bias exists, no entry-timeframe reading yet -> developing, confidence is
// just the bias's own confidence.
{
  const result = analyzeSymbol({
    "4h": [sig({ stage: "candidate", confidence: 55, timeframe: "4h" })],
  });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].stage, "developing");
  assert.strictEqual(result[0].entryTimeframe, null);
  assert.strictEqual(result[0].confidence, 55);
  assert.deepStrictEqual([result[0].zoneLow, result[0].zoneHigh], [90, 100]);
}

// Bias + a forming (not yet broken) entry AT THE SAME ZONE -> candidate.
{
  const result = analyzeSymbol({
    "4h": [sig({ stage: "candidate", confidence: 60, timeframe: "4h" })],
    "15m": [
      sig({
        stage: "candidate",
        confidence: 50,
        necklineBroken: false,
        timeframe: "15m",
        firstExtreme: { price: 96 },
        secondExtreme: { price: 95 },
        neckline: 92,
      }),
    ],
  });
  assert.strictEqual(result[0].stage, "candidate");
  assert.strictEqual(result[0].entryTimeframe, "15m");
  assert.strictEqual(result[0].confidence, 55, "average of bias(60) and entry(50)");
}

// Bias + a LIVE, broken entry at the same zone -> confirmed, the
// actionable case.
{
  const result = analyzeSymbol({
    "4h": [sig({ stage: "confirmed", confidence: 70, timeframe: "4h" })],
    "15m": [
      sig({
        stage: "confirmed",
        confidence: 80,
        necklineBroken: true,
        timeframe: "15m",
        firstExtreme: { price: 96 },
        secondExtreme: { price: 95 },
        neckline: 92,
      }),
    ],
  });
  assert.strictEqual(result[0].stage, "confirmed");
  assert.strictEqual(result[0].entryTimeframe, "15m");
  // 70*0.4 + 80*0.6 = 76, +10 alignment bonus = 86
  assert.strictEqual(result[0].confidence, 86);
}

// KEY CASE: an entry that faces the same direction but sits at a
// completely different price level should be ignored, direction alone
// isn't enough, it has to be reacting to the same zone the bias flagged.
{
  const result = analyzeSymbol({
    "4h": [sig({ stage: "confirmed", confidence: 70, timeframe: "4h", firstExtreme: { price: 100 }, secondExtreme: { price: 99 }, neckline: 90 })],
    "15m": [
      sig({
        stage: "confirmed",
        confidence: 95,
        necklineBroken: true,
        timeframe: "15m",
        firstExtreme: { price: 50 }, // nowhere near the 4h's [90, 100] zone
        secondExtreme: { price: 49 },
        neckline: 45,
      }),
    ],
  });
  assert.strictEqual(result[0].stage, "developing", "an entry at an unrelated price level shouldn't count");
  assert.strictEqual(result[0].entryTimeframe, null);
  assert.strictEqual(result[0].confidence, 70, "should fall back to the bias's own confidence, not the irrelevant entry's");
}

// An entry just outside the exact zone but within tolerance should still count.
{
  const result = analyzeSymbol({
    "4h": [sig({ stage: "confirmed", confidence: 70, timeframe: "4h", firstExtreme: { price: 100 }, secondExtreme: { price: 99 }, neckline: 90 })],
    "15m": [
      sig({
        stage: "confirmed",
        confidence: 80,
        necklineBroken: true,
        timeframe: "15m",
        firstExtreme: { price: 101.5 }, // just above the zone high of 100, within the 3% tolerance band
        secondExtreme: { price: 101 },
        neckline: 100.5,
      }),
    ],
  });
  assert.strictEqual(result[0].stage, "confirmed", "a slight overshoot within tolerance should still count");
}

// double_top and double_bottom are independent: a 4h bias for one
// direction shouldn't manufacture a signal for the opposite direction.
{
  const result = analyzeSymbol({
    "4h": [sig({ patternType: "double_top", stage: "confirmed", confidence: 70, timeframe: "4h" })],
    "15m": [sig({ patternType: "double_bottom", stage: "confirmed", confidence: 90, necklineBroken: true, timeframe: "15m", firstExtreme: { price: 100 }, secondExtreme: { price: 101 }, neckline: 110 })],
  });
  assert.strictEqual(result.length, 1, "only double_top should surface, double_bottom has no 4h/1h bias");
  assert.strictEqual(result[0].patternType, "double_top");
  assert.strictEqual(result[0].stage, "developing", "no double_top entry-timeframe reading exists");
}

// Confidence never exceeds 99 even with a strong bias and strong entry.
{
  const result = analyzeSymbol({
    "4h": [sig({ stage: "confirmed", confidence: 99, timeframe: "4h" })],
    "15m": [
      sig({
        stage: "confirmed",
        confidence: 99,
        necklineBroken: true,
        timeframe: "15m",
        firstExtreme: { price: 96 },
        secondExtreme: { price: 95 },
        neckline: 92,
      }),
    ],
  });
  assert.strictEqual(result[0].confidence, 99);
}

// getZone: a top's zone runs from its neckline up to its higher extreme,
// a bottom's from its lower extreme up to its neckline.
{
  const top = getZone({ firstExtreme: { price: 100 }, secondExtreme: { price: 98 }, neckline: 90 }, true);
  assert.deepStrictEqual(top, { low: 90, high: 100 });

  const bottom = getZone({ firstExtreme: { price: 50 }, secondExtreme: { price: 52 }, neckline: 60 }, false);
  assert.deepStrictEqual(bottom, { low: 50, high: 60 });
}

// Nothing anywhere -> nothing back.
{
  const result = analyzeSymbol({});
  assert.strictEqual(result.length, 0);
}

console.log("bias/entry analysis tests passed");