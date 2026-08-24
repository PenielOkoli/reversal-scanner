/**
 * Shared Telegram bot instance. Runs in polling mode (this worker is
 * already a long-running process, no need for a separate webhook
 * endpoint/public URL just to receive the /start command). notify/telegram.js
 * reuses this same instance to send signal alerts, so there's only ever one
 * bot connection open.
 */
const TelegramBot = require("node-telegram-bot-api");
const { supabase } = require("./db");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const token = match?.[1]?.trim();

  if (!token) {
    await bot.sendMessage(chatId, "Open this link from the Reversal Scanner dashboard to connect your account.");
    return;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, telegram_link_token_expires_at")
    .eq("telegram_link_token", token)
    .maybeSingle();

  if (error) {
    console.error("Telegram link lookup failed:", error.message);
    await bot.sendMessage(chatId, "Something went wrong, try connecting again from the dashboard.");
    return;
  }

  if (!profile || new Date(profile.telegram_link_token_expires_at) < new Date()) {
    await bot.sendMessage(chatId, "That link has expired. Generate a new one from the dashboard and try again.");
    return;
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      telegram_chat_id: String(chatId),
      telegram_enabled: true,
      telegram_link_token: null,
      telegram_link_token_expires_at: null,
    })
    .eq("id", profile.id);

  if (updateError) {
    console.error("Telegram link save failed:", updateError.message);
    await bot.sendMessage(chatId, "Connected, but saving failed on our end, try again from the dashboard.");
    return;
  }

  await bot.sendMessage(chatId, "Connected. You'll get signal alerts here from now on.");
});

bot.on("polling_error", (err) => console.error("Telegram polling error:", err.message));

module.exports = { bot };
