-- ============================================================================
-- 0025: existing and updated installs are never asked for a referral code.
--
-- Only a brand-new install, while the "require a referral code" switch is on, is asked (that is "ref_required").
-- For every other device the app is told "referred: true", which the app reads as "nothing to ask". This works for
-- every version of the app that is already installed, so nobody has to update for it to take effect.
--
-- Replaces only the two top functions public.byo_device_checkin and public.byo_device_flags (they call the base
-- functions kept by 0019). Nothing is renamed, so it is safe to run more than once. Run it AFTER 0020 and 0022.
-- ============================================================================
create or replace function public.byo_device_checkin(p_device_key text, p_state jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare r jsonb; v_req boolean;
begin   -- prov-wrapper
    r := coalesce(byo._device_checkin_base(p_device_key, p_state), '{}'::jsonb);
    v_req := byo._ref_required(p_device_key);
    r := r || jsonb_build_object('provision', exists(select 1 from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days'),
                                 'ref_required', v_req);
    r := r || jsonb_build_object('referred', case when v_req then exists(select 1 from byo.referrals where device_key = p_device_key) else true end);
    return r;
end $$;
revoke all on function public.byo_device_checkin(text,jsonb) from public;
grant execute on function public.byo_device_checkin(text,jsonb) to anon, authenticated;

create or replace function public.byo_device_flags(p_device_key text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare r jsonb; v_req boolean;
begin   -- prov-wrapper
    r := coalesce(byo._device_flags_base(p_device_key), '{}'::jsonb);
    v_req := byo._ref_required(p_device_key);
    r := r || jsonb_build_object('provision', exists(select 1 from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days'),
                                 'ref_required', v_req);
    r := r || jsonb_build_object('referred', case when v_req then exists(select 1 from byo.referrals where device_key = p_device_key) else true end);
    return r;
end $$;
revoke all on function public.byo_device_flags(text) from public;
grant execute on function public.byo_device_flags(text) to anon, authenticated;
notify pgrst, 'reload schema';
