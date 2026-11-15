-- ============================================================================
-- Referral code required for NEW installs (no skipping).
--   * byo.app_config key 'referral_required_from': installs first seen after this moment must enter a valid
--     salesperson code before using the app. Devices that already existed are not affected.
--   * the app's check-in / flag poll now also returns "ref_required" for such a device until its code is accepted.
--   * console actions fleet.referral_gate_get / fleet.referral_gate_set (on / off).
-- Builds on 0018 and 0019 (run them first). Safe to run more than once. This turns the requirement ON from now.
-- To switch it off later: use the checkbox on the console Sales team screen, or
--   delete from byo.app_config where key = 'referral_required_from';
-- ============================================================================
insert into byo.app_config(key, value) values ('referral_required_from', to_jsonb(now()::text)) on conflict (key) do nothing;

create or replace function byo._ref_required(p_device_key text) returns boolean
language sql stable security definer set search_path = byo, public as $$
    select coalesce(
        (select (value #>> '{}')::timestamptz from byo.app_config where key = 'referral_required_from')
          <= (select first_seen from byo.tv_devices where device_key = p_device_key), false)
       and not exists (select 1 from byo.referrals where device_key = p_device_key);
$$;
revoke all on function byo._ref_required(text) from public, anon, authenticated;

create or replace function public.byo_device_checkin(p_device_key text, p_state jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare r jsonb;
begin   -- prov-wrapper
    r := coalesce(byo._device_checkin_base(p_device_key, p_state), '{}'::jsonb);
    return r || jsonb_build_object('provision', exists(select 1 from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days'),
                                   'ref_required', byo._ref_required(p_device_key));
end $$;
revoke all on function public.byo_device_checkin(text,jsonb) from public;
grant execute on function public.byo_device_checkin(text,jsonb) to anon, authenticated;

create or replace function public.byo_device_flags(p_device_key text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare r jsonb;
begin   -- prov-wrapper
    r := coalesce(byo._device_flags_base(p_device_key), '{}'::jsonb);
    return r || jsonb_build_object('provision', exists(select 1 from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days'),
                                   'ref_required', byo._ref_required(p_device_key));
end $$;
revoke all on function public.byo_device_flags(text) from public;
grant execute on function public.byo_device_flags(text) to anon, authenticated;

-- console switch
do $$ begin
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'byo_support_admin' and position('ref-wrapper' in prosrc) = 0) then
        drop function if exists byo._support_admin_pre_ref(text, jsonb);
        alter function public.byo_support_admin(text, jsonb) rename to _support_admin_pre_ref;
        alter function public._support_admin_pre_ref(text, jsonb) set schema byo;
    end if;
end $$;
revoke all on function byo._support_admin_pre_ref(text, jsonb) from public, anon, authenticated;

create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- ref-wrapper: referral gate switch here, everything else goes to byo._support_admin_pre_ref
begin
    if p_action = 'fleet.referral_gate_get' then
        return jsonb_build_object('ok', true, 'on', exists(select 1 from byo.app_config where key = 'referral_required_from'),
                                  'from', (select value #>> '{}' from byo.app_config where key = 'referral_required_from'));
    end if;
    if p_action = 'fleet.referral_gate_set' then
        if coalesce((p_args->>'on')::boolean, false) then
            insert into byo.app_config(key, value) values ('referral_required_from', to_jsonb(now()::text))
            on conflict (key) do update set value = to_jsonb(now()::text), updated_at = now();     -- only installs from now on
        else delete from byo.app_config where key = 'referral_required_from'; end if;
        return jsonb_build_object('ok', true);
    end if;
    return byo._support_admin_pre_ref(p_action, p_args);
end $$;
revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;
notify pgrst, 'reload schema';
