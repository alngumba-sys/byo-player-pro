-- ============================================================================
-- Fix: billing_status() (checked by the TV automatically on every app launch,
-- via the device-start edge function) only ever looked at byo.subscriptions.
--
-- But M-Pesa and telebirr payments confirmed by the collector app are granted
-- through byo._grant_days(), which writes the access window into
-- byo.device_flags.flags->'access' — a table billing_status() never read.
--
-- Result: once a customer paid by M-Pesa/telebirr, the grant sat correctly in
-- the database, but the automatic "is this device paid?" check the app runs
-- every time it opens never saw it, so it kept showing "Your free trial has
-- ended" forever, even though access had been granted. The only time the app
-- ever picked up the grant was during the live few-minutes "Verifying
-- payment" screen right after paying — if that timed out or the app was
-- closed before it finished, the device was stuck.
--
-- This makes billing_status() treat an active byo.device_flags access grant
-- the same as an active byo.subscriptions row.
-- ============================================================================
create or replace function byo.billing_status(p_device_id text)
returns table(state text, trial_ends_at timestamptz, sub_expires_at timestamptz)
language plpgsql security definer set search_path = byo as $$
declare
    v_trial_end timestamptz;
    v_sub       timestamptz;
    v_access    jsonb;
    v_flag_until timestamptz;
begin
    select d.trial_started_at + (byo.trial_days() || ' days')::interval into v_trial_end
      from byo.devices d where d.device_id = p_device_id;

    select s.expires_at into v_sub
      from byo.subscriptions s where s.device_id = p_device_id and s.status = 'active';

    -- M-Pesa / telebirr grants (byo._grant_days) live in device_flags, not subscriptions.
    select flags->'access' into v_access from byo.device_flags where device_key = p_device_id;
    if v_access is not null and v_access->>'state' = 'active' and (v_access->>'until') is not null then
        v_flag_until := (v_access->>'until')::timestamptz;
    end if;

    -- Whichever grant (subscription row or device_flags access) expires later wins.
    if v_flag_until is not null and (v_sub is null or v_flag_until > v_sub) then
        v_sub := v_flag_until;
    end if;

    return query select
        case when v_sub is not null and v_sub > now() then 'active'
             when v_trial_end is not null and v_trial_end > now() then 'trial'
             else 'expired' end,
        v_trial_end, v_sub;
end; $$;
