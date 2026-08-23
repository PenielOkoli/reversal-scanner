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
- Exact per-user pair cap inside the confirmed 15-20 range (schema defaults to 20,
  override per-user via profiles.pair_cap)

## Done

- Schema: supabase/schema.sql (profiles, watchlist_items, signals,
  signal_deliveries, DB-level cap trigger, RLS policies). Not yet run against a
  live Supabase project.
- db.js implemented against that schema, including per-user per-stage delivery
  tracking so repeat scan passes don't spam the same notification.
- Web dashboard (apps/web): Next.js 16 App Router + Tailwind v4, Supabase Auth
  for sign in/up, proxy.ts (Next 16's replacement for middleware.ts) gating
  /dashboard. Design system: dark theme, Space Grotesk/Inter/JetBrains Mono,
  a 3-segment StageMeter as the signature element for the developing/
  candidate/confirmed progression. Pair selector enforces the pair cap
  client-side and relies on the DB trigger as the real backstop.
