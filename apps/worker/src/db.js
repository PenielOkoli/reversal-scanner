/**
 * Data-access layer over the schema in supabase/schema.sql.
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Every symbol currently selected by at least one user, deduplicated.
// This is what the worker actually polls Bybit for, on every timeframe.
async function getActiveSymbols() {
  const { data, error } = await supabase.from("watchlist_items").select("symbol");
  if (error) throw error;
  return [...new Set(data.map((row) => row.symbol))];
}

// Every user watching a given symbol, with their notification preferences
// already resolved (null if that channel is off for them).
async function getSubscribersFor(symbol) {
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("user_id, profiles!inner(telegram_chat_id, telegram_enabled, push_subscription, push_enabled)")
    .eq("symbol", symbol);
  if (error) throw error;

  return data.map((row) => ({
    userId: row.user_id,
    telegramChatId: row.profiles.telegram_enabled ? row.profiles.telegram_chat_id : null,
    pushSubscription: row.profiles.push_enabled ? row.profiles.push_subscription : null,
  }));
}

// Upserts a signal on its natural key (symbol, patternType): one row per
// direction per symbol, the best combined read across every timeframe,
// updating in place as the picture evolves instead of duplicating rows.
async function saveSignal(signal) {
  const key = {
    symbol: signal.symbol,
    pattern_type: signal.patternType,
  };

  const row = {
    ...key,
    timeframe: signal.timeframe,
    pattern_timeframe: signal.patternTimeframe || null,
    confirmation_timeframe: signal.confirmationTimeframe || null,
    entry_timeframe: signal.entryTimeframe || null,
    zone_low: signal.zoneLow,
    zone_high: signal.zoneHigh,
    alert_state: signal.alertState,
    current_price: signal.currentPrice,
    trigger_price: signal.triggerPrice,
    invalidation_price: signal.invalidationPrice,
    target_price: signal.targetPrice,
    distance_to_trigger_percent: signal.distanceToTriggerPercent,
    daily_open: signal.dailyOpen,
    previous_day_high: signal.previousDayHigh,
    previous_day_low: signal.previousDayLow,
    daily_level_confluence: signal.dailyLevelConfluence,
    stage: signal.stage,
    first_extreme_price: signal.firstExtreme.price,
    first_extreme_index: signal.firstExtreme.index,
    first_extreme_time: signal.firstExtreme.time,
    second_extreme_price: signal.secondExtreme.price,
    second_extreme_index: signal.secondExtreme.index,
    second_extreme_time: signal.secondExtreme.time,
    distance_percent: signal.distancePercent,
    bars_apart: signal.barsApart,
    rsi_divergence: signal.rsiDivergence,
    volume_trend: signal.volumeTrend,
    neckline: signal.neckline,
    neckline_broken: signal.necklineBroken,
    confidence: signal.confidence,
    funding_confluence: signal.fundingConfluence,
    open_interest_trend: signal.openInterestTrend,
    detected_at: signal.detectedAt,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("signals")
    .upsert(row, { onConflict: "symbol,pattern_type" })
    .select("id")
    .single();
  if (error) throw error;

  return { signalId: data.id };
}

// Per-(signal, user, stage) delivery tracking, so a signal sitting at the
// same stage across several scan passes doesn't re-notify every pass, but
// a genuine stage change does, and a user who adds a pair later still gets
// notified about a signal that already exists on it.
async function hasBeenDelivered(signalId, userId, stage, channel) {
  const { data, error } = await supabase
    .from("signal_deliveries")
    .select("signal_id")
    .match({ signal_id: signalId, user_id: userId, stage_notified: stage, channel })
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function markDelivered(signalId, userId, stage, channel) {
  const { error } = await supabase
    .from("signal_deliveries")
    .insert({ signal_id: signalId, user_id: userId, stage_notified: stage, channel });
  // Unique-violation just means another pass already recorded this, that's fine.
  if (error && error.code !== "23505") throw error;
}

module.exports = {
  supabase,
  getActiveSymbols,
  getSubscribersFor,
  saveSignal,
  hasBeenDelivered,
  markDelivered,
};
