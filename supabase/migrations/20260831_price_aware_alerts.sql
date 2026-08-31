-- Upgrade an existing project to the price-aware alert model.
-- Scanner signals are derived data, so older duplicates are consolidated to
-- the newest row per (symbol, direction) before the new natural key is added.

begin;

-- A watchlist symbol now covers every supported timeframe. Retain the oldest
-- row when a user previously watched the same symbol on multiple timeframes.
delete from public.watchlist_items older
using public.watchlist_items newer
where older.user_id = newer.user_id
  and older.symbol = newer.symbol
  and (
    older.created_at > newer.created_at
    or (older.created_at = newer.created_at and older.id::text > newer.id::text)
  );

alter table public.watchlist_items drop column if exists timeframe;
-- Older deployments may already have this constraint (or an equivalent
-- unique index under a different name). Add it only when it is genuinely
-- missing, so the migration remains safe to rerun.
do $$
declare
  has_user_symbol_unique boolean;
begin
  select exists (
    select 1
    from pg_index index_def
    where index_def.indrelid = 'public.watchlist_items'::regclass
      and index_def.indisunique
      and index_def.indpred is null
      and array_length(index_def.indkey, 1) = 2
      and index_def.indkey::smallint[] @> array[
        (select attnum from pg_attribute where attrelid = 'public.watchlist_items'::regclass and attname = 'user_id' and not attisdropped),
        (select attnum from pg_attribute where attrelid = 'public.watchlist_items'::regclass and attname = 'symbol' and not attisdropped)
      ]::smallint[]
  ) into has_user_symbol_unique;

  if not has_user_symbol_unique then
    alter table public.watchlist_items
      add constraint watchlist_items_user_symbol_20260831_key unique (user_id, symbol);
  end if;
end $$;
drop index if exists public.watchlist_items_symbol_timeframe_idx;
create index if not exists watchlist_items_symbol_idx on public.watchlist_items (symbol);

-- Keep the newest derived scanner row for each symbol/direction. Deliveries
-- cascade with the discarded rows and will be recreated only on a new state.
delete from public.signals older
using public.signals newer
where older.symbol = newer.symbol
  and older.pattern_type = newer.pattern_type
  and (
    older.updated_at < newer.updated_at
    or (older.updated_at = newer.updated_at and older.id::text > newer.id::text)
  );

alter table public.signals
  drop constraint if exists signals_symbol_timeframe_pattern_type_first_extreme_index_key,
  add column if not exists pattern_timeframe text,
  add column if not exists confirmation_timeframe text,
  add column if not exists entry_timeframe text,
  add column if not exists zone_low numeric,
  add column if not exists zone_high numeric,
  add column if not exists alert_state text,
  add column if not exists current_price numeric,
  add column if not exists trigger_price numeric,
  add column if not exists invalidation_price numeric,
  add column if not exists target_price numeric,
  add column if not exists distance_to_trigger_percent numeric,
  add column if not exists daily_open numeric,
  add column if not exists previous_day_high numeric,
  add column if not exists previous_day_low numeric,
  add column if not exists daily_level_confluence jsonb;

update public.signals
set
  zone_low = least(neckline, first_extreme_price, second_extreme_price),
  zone_high = greatest(neckline, first_extreme_price, second_extreme_price),
  alert_state = case stage
    when 'confirmed' then 'triggered'
    when 'candidate' then 'setup'
    else 'watch'
  end,
  trigger_price = neckline,
  invalidation_price = case pattern_type
    when 'double_top' then greatest(first_extreme_price, second_extreme_price) * 1.003
    else least(first_extreme_price, second_extreme_price) * 0.997
  end,
  target_price = case pattern_type
    when 'double_top' then neckline - (greatest(first_extreme_price, second_extreme_price) - neckline)
    else neckline + (neckline - least(first_extreme_price, second_extreme_price))
  end
where zone_low is null
   or zone_high is null
   or alert_state is null
   or trigger_price is null
   or invalidation_price is null
   or target_price is null;

alter table public.signals
  alter column zone_low set not null,
  alter column zone_high set not null,
  alter column alert_state set not null,
  alter column trigger_price set not null,
  alter column invalidation_price set not null,
  alter column target_price set not null;

-- Replace any earlier alert-state check by meaning, not by its generated
-- name. This makes the migration safe after an interrupted/renamed rollout.
do $$
declare
  has_symbol_pattern_unique boolean;
  constraint_name text;
begin
  for constraint_name in
    select constraint_def.conname
    from pg_constraint constraint_def
    where constraint_def.conrelid = 'public.signals'::regclass
      and constraint_def.contype = 'c'
      and pg_get_constraintdef(constraint_def.oid) like '%alert_state%'
  loop
    execute format('alter table public.signals drop constraint if exists %I', constraint_name);
  end loop;

  alter table public.signals
    add constraint signals_alert_state_20260831_check
    check (alert_state in ('watch', 'setup', 'confirmed', 'triggered'));

  select exists (
    select 1
    from pg_index index_def
    where index_def.indrelid = 'public.signals'::regclass
      and index_def.indisunique
      and index_def.indpred is null
      and array_length(index_def.indkey, 1) = 2
      and index_def.indkey::smallint[] @> array[
        (select attnum from pg_attribute where attrelid = 'public.signals'::regclass and attname = 'symbol' and not attisdropped),
        (select attnum from pg_attribute where attrelid = 'public.signals'::regclass and attname = 'pattern_type' and not attisdropped)
      ]::smallint[]
  ) into has_symbol_pattern_unique;

  if not has_symbol_pattern_unique then
    alter table public.signals
      add constraint signals_symbol_pattern_20260831_key unique (symbol, pattern_type);
  end if;
end $$;

drop index if exists public.signals_symbol_timeframe_idx;
create index if not exists signals_symbol_idx on public.signals (symbol);

-- Delivery state is channel-specific. A failed Telegram send must not block
-- a retry, and a successful push must not suppress the Telegram alert.
-- Existing rows are retained as legacy history and deliberately do not block
-- the first channel-specific delivery after this upgrade.
alter table public.signal_deliveries
  add column if not exists channel text;

update public.signal_deliveries
set channel = 'legacy'
where channel is null;

alter table public.signal_deliveries
  alter column channel set not null,
  drop constraint if exists signal_deliveries_pkey,
  drop constraint if exists signal_deliveries_channel_check,
  add constraint signal_deliveries_pkey primary key (signal_id, user_id, stage_notified, channel),
  add constraint signal_deliveries_channel_check check (channel in ('telegram', 'push', 'legacy'));

commit;
