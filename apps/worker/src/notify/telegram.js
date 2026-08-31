const { bot } = require("../telegram-bot");
const { formatSignalMessage, formatDigestMessage } = require("./format");

async function sendTelegramSignal(chatId, signal) {
  await bot.sendMessage(chatId, formatSignalMessage(signal));
}

async function sendTelegramDigest(chatId, signals) {
  if (!signals.length) return;
  if (signals.length === 1) return sendTelegramSignal(chatId, signals[0]);
  await bot.sendMessage(chatId, formatDigestMessage(signals));
}

module.exports = { sendTelegramSignal, sendTelegramDigest, formatSignalMessage, formatDigestMessage };
