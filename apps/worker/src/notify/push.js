const webpush = require("web-push");

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_CONTACT_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushSignal(subscription, signal) {
  const direction = signal.patternType === "double_top" ? "Bearish" : "Bullish";
  const entryPart = signal.entryTimeframe
    ? `entry on ${signal.entryTimeframe}${signal.stage === "confirmed" ? " (live)" : " (forming)"}`
    : "no entry yet";
  const payload = JSON.stringify({
    title: `${signal.symbol} - ${direction} bias (${signal.timeframe}) @ ${signal.zoneLow}-${signal.zoneHigh}`,
    body: `${entryPart} - confidence ${signal.confidence}%`,
  });
  await webpush.sendNotification(subscription, payload);
}

async function sendPushDigest(subscription, signals) {
  if (!signals.length) return;
  if (signals.length === 1) return sendPushSignal(subscription, signals[0]);

  const payload = JSON.stringify({
    title: `${signals.length} signal updates`,
    body: signals
      .map((s) => `${s.symbol} ${s.patternType === "double_top" ? "bearish" : "bullish"} (${s.stage})`)
      .join(", "),
  });
  await webpush.sendNotification(subscription, payload);
}

module.exports = { sendPushSignal, sendPushDigest };