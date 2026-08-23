const webpush = require("web-push");

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_CONTACT_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushSignal(subscription, signal) {
  const payload = JSON.stringify({
    title: `${signal.symbol} ${signal.patternType.replace("_", " ")}`,
    body: `${signal.stage} on ${signal.timeframe} - confidence ${signal.confidence}%`,
  });
  await webpush.sendNotification(subscription, payload);
}

module.exports = { sendPushSignal };
