# Reversal Scanner

Multi-pair, multi-timeframe crypto double top / double bottom scanner for
Bybit perpetuals. Surfaces staged signals (developing / candidate /
confirmed) per user watchlist. No auto-trading.

## Structure

    packages/detector       Pattern detection engine (pure functions, no deps)
    packages/bybit-client   Minimal Bybit v5 REST client (klines, symbols)
    apps/worker             Scheduled scanner: polls Bybit, runs the
                             detector, notifies subscribers via Telegram / push
    apps/web                Dashboard (not scaffolded yet, see apps/web/README.md)
    docs/architecture.md    Data flow and decisions log
    supabase/schema.sql     Postgres schema: profiles, watchlist_items, signals,
                             signal_deliveries, cap trigger, RLS policies

## Getting started

    npm install
    npm run test:detector   # runs the detector's test suite

Copy `apps/worker/.env.example` to `apps/worker/.env` and fill in Supabase,
Telegram, and VAPID credentials before running the worker. The Bybit client
needs live network access to api.bybit.com to actually pull candles, so its
first real test needs to happen outside this scaffold's build environment.

### Database upgrades

For a new project, run `supabase/schema.sql`. For a project created before
the price-aware alert update, run
`supabase/migrations/20260831_price_aware_alerts.sql` once in the Supabase
SQL editor before starting the worker. It consolidates duplicate, derived
scanner rows and converts watchlists to one row per symbol.

### Alert states

- **Watch** — price is near a valid 4h support/resistance zone; shown in the
  dashboard only.
- **Setup** — a direction-aligned 1h reversal pattern has formed at that 4h
  zone; wait for 15m confirmation.
- **Confirmed** — a direction-aligned 15m neckline break confirms structure;
  wait for a 5m execution break.
- **Triggered** — the direction-aligned 5m neckline is currently broken and
  price has not moved too far past the trigger; eligible for an alert.

Signals that have moved away from their zone, are too far past a breakout, or
conflict with an equally mature opposite-direction signal are suppressed. A
current daily open, previous-day high, or previous-day low must also overlap
the 4h zone before the scanner surfaces the setup.
The displayed setup score is a heuristic, not a probability or a guarantee.

## Status

- [x] Detector engine: built and tested against synthetic double-top and
      double-bottom data (developing / candidate / confirmed all verified)
- [x] Bybit client: klines + symbol list (structure verified against docs,
      not yet smoke-tested against live data)
- [x] Supabase schema (supabase/schema.sql) + db.js wired against it (untested against a live project, needs real credentials)
- [ ] Worker deployed and running against live data
- [x] Web dashboard: auth (sign in/up), pair+timeframe watchlist (cap-aware),
      signal table. Typechecked and build-verified (fonts need real internet
      access to Google Fonts, unavailable in the build sandbox, verified
      separately with a stand-in font)
- [x] Telegram bot linking flow: dashboard generates a token, deep-links to
      the bot, worker's bot (polling mode) confirms and saves the chat id
- [x] Push notification subscription flow: service worker, VAPID subscribe/
      unsubscribe, saved to profiles.push_subscription
- [x] Funding rate + open interest confluence signal grading
