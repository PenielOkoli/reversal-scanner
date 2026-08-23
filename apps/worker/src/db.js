/**
 * Thin data-access layer. Swap the guts of these functions once the
 * Supabase schema is finalized, keep the signatures stable so scan.js
 * doesn't need to change when the schema does.
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Returns the union of every (symbol, timeframe) pair currently selected by
// at least one user, e.g. [{ symbol: "BTCUSDT", timeframe: "1h" }, ...].
// TODO: implement against the real watchlist table.
async function getActiveWatchlistCombos() {
  throw new Error("TODO: query the watchlist table");
}

// Returns every user subscribed to a given (symbol, timeframe) combo, with
// their notification preferences (telegram chat id, push subscription).
// TODO: implement against the watchlist + notification_prefs tables.
async function getSubscribersFor(symbol, timeframe) {
  throw new Error("TODO: query subscribers for this combo");
}

// Persists a signal, returns true if it's new/changed (so callers know
// whether to notify) vs. an unchanged repeat of an already-seen signal.
// TODO: implement upsert against a signals table, keyed on
// (symbol, timeframe, patternType, firstExtreme.index) or similar.
async function saveSignal(signal) {
  throw new Error("TODO: upsert into the signals table");
}

module.exports = { supabase, getActiveWatchlistCombos, getSubscribersFor, saveSignal };
