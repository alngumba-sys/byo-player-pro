-- ============================================================================
-- BYO Player Pro: no automatic free trial.
--
-- New devices no longer get free days on their own. BYO Player runs only for
-- the time BYO support sets ("Enable N days" / "+N days" in the support
-- console) or a paid subscription.
--
-- Not needed today: the billing Edge Functions (device-start, billing-status)
-- are not deployed, so the app uses its own setting (BILLING_CONFIG.trialDays,
-- now 0). Run this before deploying those functions, so the server agrees.
--
-- Written for the live database, which has byo.devices but no byo.app_config
-- and no byo.trial_days(): both are created here, with the trial set to 0.
-- ============================================================================

create table if not exists byo.app_config (
    key        text primary key,
    value      jsonb not null,
    updated_at timestamptz not null default now()
);
alter table byo.app_config enable row level security;

insert into byo.app_config(key, value) values ('trial_days', '0'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function byo.trial_days() returns integer
language sql stable set search_path = byo as $$
    select coalesce((select (value)::text::integer from byo.app_config where key = 'trial_days'), 0);
$$;
