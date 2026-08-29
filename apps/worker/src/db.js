/**
 * Data-access layer over the schema in supabase/schema.sql.
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Every (symbol, timeframe) currently selected by at least one user,
// deduplicated. This is what the worker actually polls Bybit for.
async function getActiveWatchlistCombos() {
  const { data, error } = await supabase.from("watchlist_items").select("symbol, timeframe");
  if (error) throw error;

  const seen = new Set();
  const combos = [];
  for (const row of data) {
    const key = `${row.symbol}:${row.timeframe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push({ symbol: row.symbol, timeframe: row.timeframe });
  }
  return combos;
}

// Every user watching a given (symbol, timeframe), with their notification
// preferences already resolved (null if that channel is off for them).
async function getSubscribersFor(symbol, timeframe) {
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("user_id, profiles!inner(telegram_chat_id, telegram_enabled, push_subscription, push_enabled)")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe);
  if (error) throw error;

  return data.map((row) => ({
    userId: row.user_id,
    telegramChatId: row.profiles.telegram_enabled ? row.profiles.telegram_chat_id : null,
    pushSubscription: row.profiles.push_enabled ? row.profiles.push_subscription : null,
  }));
}

// Upserts a signal on its natural key (symbol, timeframe, patternType,
// firstExtreme.index), so the same underlying pattern updates in place as
// it moves through stages instead of duplicating rows.
async function saveSignal(signal) {
  const key = {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    pattern_type: signal.patternType,
    first_extreme_index: signal.firstExtreme.index,
  };

  const row = {
    ...key,
    stage: signal.stage,
    first_extreme_price: signal.firstExtreme.price,
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
    .upsert(row, { onConflict: "symbol,timeframe,pattern_type,first_extreme_index" })
    .select("id")
    .single();
  if (error) throw error;

  return { signalId: data.id };
}

// Per-(signal, user, stage) delivery tracking, so a signal sitting at the
// same stage across several scan passes doesn't re-notify every pass, but
// a genuine stage change does, and a user who adds a pair later still gets
// notified about a signal that already exists on it.
async function hasBeenDelivered(signalId, userId, stage) {
  const { data, error } = await supabase
    .from("signal_deliveries")
    .select("signal_id")
    .match({ signal_id: signalId, user_id: userId, stage_notified: stage })
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function markDelivered(signalId, userId, stage) {
  const { error } = await supabase
    .from("signal_deliveries")
    .insert({ signal_id: signalId, user_id: userId, stage_notified: stage });
  // Unique-violation just means another pass already recorded this, that's fine.
  if (error && error.code !== "23505") throw error;
}

module.exports = {
  supabase,
  getActiveWatchlistCombos,
  getSubscribersFor,
  saveSignal,
  hasBeenDelivered,
  markDelivered,
};
