const webpush = require("web-push");

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_CONTACT_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function formatPrice(value) {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function triggerText(signal) {
  const side = signal.patternType === "double_top" ? "below" : "above";
  return `close ${side} ${formatPrice(signal.triggerPrice)}`;
}

async function sendPushSignal(subscription, signal) {
  const state = signal.alertState === "triggered"
    ? "TRIGGERED"
    : signal.alertState === "confirmed"
      ? "15M CONFIRMED"
      : "SETUP";
  const entry = signal.alertState === "triggered"
    ? "5m execution is live"
    : signal.alertState === "confirmed"
      ? "wait for a 5m execution break"
      : "1h pattern formed; wait for 15m confirmation";
  const payload = JSON.stringify({
    title: `${state}: ${signal.symbol} ${signal.entryTimeframe || signal.timeframe}`,
    body: `Current ${formatPrice(signal.currentPrice)} | ${entry}; trigger: ${triggerText(signal)}.`,
  });
  await webpush.sendNotification(subscription, payload);
}

async function sendPushDigest(subscription, signals) {
  if (!signals.length) return;
  if (signals.length === 1) return sendPushSignal(subscription, signals[0]);

  const payload = JSON.stringify({
    title: `${signals.length} actionable setup updates`,
    body: signals
      .map((signal) => `${signal.symbol}: ${signal.alertState} (${triggerText(signal)})`)
      .join(", "),
  });
  await webpush.sendNotification(subscription, payload);
}

module.exports = { sendPushSignal, sendPushDigest };
