const assert = require("assert");
const { formatSignalMessage, formatDigestMessage } = require("./format");

const setup = {
  symbol: "BTCUSDT",
  patternType: "double_top",
  alertState: "setup",
  timeframe: "4h",
  currentPrice: 78587.4,
  zoneLow: 75550,
  zoneHigh: 79559.2,
  triggerPrice: 75550,
  invalidationPrice: 79797.88,
  targetPrice: 71540.8,
  confidence: 74,
  dailyOpen: 78286.1,
  previousDayHigh: 79559.2,
  previousDayLow: 75550,
  dailyLevelConfluence: ["daily_open", "previous_day_high"],
};

const setupMessage = formatSignalMessage(setup);
assert.match(setupMessage, /EARLY BEARISH SETUP/);
assert.match(setupMessage, /Current: 78,587.4/);
assert.match(setupMessage, /4h resistance context near 79,559.2 \| 1h double top established/);
assert.match(setupMessage, /No trade yet\. Wait for a 15m bearish reversal/i);
assert.match(setupMessage, /Daily confluence: Daily open 78,286.1 \+ PDH 79,559.2/);
assert.doesNotMatch(setupMessage, /Invalidation|Target reference/);
assert.match(setupMessage, /Current: 78,587.4\n\nNo trade yet/);

const triggeredMessage = formatSignalMessage({ ...setup, alertState: "triggered" });
assert.match(triggeredMessage, /BEARISH EXECUTION/);
assert.match(triggeredMessage, /Execution plan: close below 75,550 \| Invalidation: close above 79,797.88/);

const digest = formatDigestMessage([setup, { ...setup, symbol: "ETHUSDT", alertState: "triggered" }]);
assert.match(digest, /2 signal updates/);
assert.match(digest, /\[EARLY BEARISH SETUP\] BTCUSDT/);
assert.match(digest, /\[BEARISH EXECUTION\] ETHUSDT/);

console.log("notification format tests passed");
