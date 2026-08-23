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
- [ ] Telegram bot linking flow
- [ ] Push notification subscription flow
