-- BYO Player Pro: free trial extended from 3 to 8 days.
-- Applies to every device, including ones already in their trial, because the
-- end date is always worked out as trial_started_at + trial_days.
insert into byo.app_config(key, value) values ('trial_days', '8'::jsonb)
on conflict (key) do update set value = excluded.value;
