-- Reversal Scanner: Supabase schema
-- Run this in the Supabase SQL editor (or via the CLI migration flow)
-- against a fresh project. Auth itself is handled by Supabase Auth
-- (auth.users); everything below extends it.

-- Per-user app settings, one row per auth user.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  telegram_chat_id text,
  telegram_enabled boolean not null default false,
  telegram_link_token text unique,
  telegram_link_token_expires_at timestamptz,
  push_subscription jsonb,
  push_enabled boolean not null default false,
  in_app_enabled boolean not null default true,
  pair_cap integer not null default 20,
  created_at timestamptz not null default now()
);

-- One row per (user, symbol, timeframe) the user wants monitored.
create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  timeframe text not null check (timeframe in ('5m', '15m', '1h', '4h')),
  created_at timestamptz not null default now(),
  unique (user_id, symbol, timeframe)
);
create index watchlist_items_symbol_timeframe_idx on public.watchlist_items (symbol, timeframe);

-- Every detected signal, shared across all users watching that combo.
-- (symbol, timeframe, pattern_type, first_extreme_index) is the natural
-- key: the same underlying pattern updates in place across scan passes
-- (developing -> candidate -> confirmed) rather than duplicating rows.
create table public.signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  timeframe text not null,
  pattern_type text not null check (pattern_type in ('double_top', 'double_bottom')),
  stage text not null check (stage in ('developing', 'candidate', 'confirmed')),
  first_extreme_price numeric not null,
  first_extreme_index integer not null,
  first_extreme_time bigint not null,
  second_extreme_price numeric not null,
  second_extreme_index integer not null,
  second_extreme_time bigint not null,
  distance_percent numeric not null,
  bars_apart integer not null,
  rsi_divergence boolean not null,
  volume_trend text not null,
  neckline numeric not null,
  neckline_broken boolean not null,
  confidence integer not null,
  detected_at bigint not null,
  updated_at timestamptz not null default now(),
  unique (symbol, timeframe, pattern_type, first_extreme_index)
);
create index signals_symbol_timeframe_idx on public.signals (symbol, timeframe);
create index signals_stage_idx on public.signals (stage);

-- Tracks which user has already been notified about which signal at which
-- stage, so a signal sitting at "developing" across several scan passes
-- doesn't re-notify every pass, but a stage change (developing -> candidate
-- -> confirmed) does notify again since that's genuinely new information.
-- Also lets a user who adds a pair later still get notified about an
-- already-existing signal on it.
create table public.signal_deliveries (
  signal_id uuid not null references public.signals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_notified text not null,
  notified_at timestamptz not null default now(),
  primary key (signal_id, user_id, stage_notified)
);

-- Enforce the per-user pair cap (15-20, confirmed with the client) at the
-- database level so it can't be bypassed by a buggy or malicious client.
create or replace function public.enforce_watchlist_cap()
returns trigger as $$
declare
  current_count integer;
  cap integer;
begin
  select pair_cap into cap from public.profiles where id = new.user_id;
  if cap is null then
    cap := 20;
  end if;

  select count(*) into current_count from public.watchlist_items where user_id = new.user_id;
  if current_count >= cap then
    raise exception 'Watchlist cap reached (%). Remove a pair before adding another.', cap;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger watchlist_cap_check
before insert on public.watchlist_items
for each row execute function public.enforce_watchlist_cap();

-- Row Level Security: users can only see/edit their own data. The worker
-- connects with the service role key, which bypasses RLS entirely, so it
-- can still read every watchlist and write every signal.

alter table public.profiles enable row level security;
create policy "Users manage their own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

alter table public.watchlist_items enable row level security;
create policy "Users manage their own watchlist" on public.watchlist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.signals enable row level security;
create policy "Authenticated users can read signals" on public.signals
  for select using (auth.role() = 'authenticated');
-- No write policy for regular users on purpose. Only the worker's service
-- role key can insert/update signals.

alter table public.signal_deliveries enable row level security;
create policy "Users can read their own delivery log" on public.signal_deliveries
  for select using (auth.uid() = user_id);

-- Short-lived, single-use tokens for linking a dashboard account to a
-- Telegram chat via a deep link (t.me/<bot>?start=<token>).
create table public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz
);

alter table public.telegram_link_tokens enable row level security;
create policy "Users can create their own link token" on public.telegram_link_tokens
  for insert with check (auth.uid() = user_id);
-- No select/update policy for regular users on purpose. Only the worker's
-- service role key (the bot process) reads and consumes tokens.
