-- ============================================================================
-- BYO Player Pro: no automatic free trial.
--
-- New devices no longer get free days on their own. BYO Player runs only for
-- the time BYO support sets in the support console ("Enable N days", or
-- "+3 / +5 / +7 days", which now count from zero), or a paid subscription.
--
-- The trial end is worked out as trial_started_at + trial_days + trial_bonus_days,
-- so setting trial_days to 0 is all that is needed: support's bonus days are kept.
-- To bring an automatic trial back later, set trial_days to the number of days.
-- ============================================================================

insert into byo.app_config(key, value) values ('trial_days', '0'::jsonb)
on conflict (key) do update set value = excluded.value;
