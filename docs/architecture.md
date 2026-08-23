# Architecture

## Data flow

    Bybit v5 REST API (klines)
              |
    apps/worker  (cron poll: union of every selected pair+timeframe combo)
              |
    packages/detector  (scanForPatterns: swing points, RSI divergence,
                         volume trend, neckline, staged output)
              |
    Supabase (signals table)
        /                \
    apps/web          apps/worker/notify
    (dashboard)       (Telegram + web push)

## Key decisions

- Data source: direct Bybit v5 REST API, not TradingView. Public market
  data is free, no paid webhook plan tier needed, and it reuses the
  detection pipeline already built and tested rather than a Pine Script
  rewrite.
- One shared poll per (symbol, timeframe) combo across all users, not
  per-user. Keeps API usage flat as the user base grows.
- The detector itself is source-agnostic and dependency-free, it just
  needs a plain OHLCV array, so it isn't locked to Bybit specifically if
  that ever needs to change.
- Multi-user: each person has their own login and their own watchlist
  (15-20 pairs, confirmed with the client), not one shared dashboard.
- Alerts: in-app dashboard + Telegram + web push.
- No auto-trading. The system surfaces and ranks candidates only, the
  user reviews the chart and decides.

## Not yet decided

- Auth provider (Supabase Auth vs Clerk)
- Exact Supabase schema (watchlists, signals, notification_prefs tables)
- Exact per-user pair cap inside the confirmed 15-20 range
