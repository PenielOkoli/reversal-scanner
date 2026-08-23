# Web dashboard

Not scaffolded yet. When frontend work starts:

    cd apps/web
    npx create-next-app@latest . --typescript --tailwind --app

Then wire up:
- Auth (decided: multi-user, each person gets their own login)
- Pair/timeframe selector (cap: 15-20 pairs per user, confirmed with client)
- Signal table, reading from the same Supabase project apps/worker writes to
- Push notification subscription (pairs with apps/worker/src/notify/push.js,
  needs the same VAPID public key on this side)
