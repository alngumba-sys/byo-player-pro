-- ============================================================================
-- BYO Player Pro: show the country each TV is actually in.
-- The TV reports the region picked in its settings. This check-in now also reads the
-- country of the network the request came from (the cf-ipcountry header added by
-- Supabase's edge, when present). Only the 2-letter country code is kept: the IP
-- address itself is never stored.
--   state.country      = network country, or the TV's region when the network one is unknown
--   state.region       = the region picked on the TV
--   state.country_src  = 'network' or 'setting'
-- Needs 0010_fleet.sql. Safe to run more than once. No admin redeploy needed.
-- ============================================================================

create or replace function public.byo_device_checkin(p_device_key text, p_state jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare v_state jsonb := coalesce(p_state, '{}'::jsonb); v_net text; v_reg text;
begin
    if coalesce(trim(p_device_key),'') = '' or length(p_device_key) > 120 then return jsonb_build_object('error','bad device'); end if;
    if length(v_state::text) > 6000 then v_state := '{}'::jsonb; end if;
    begin
        v_net := upper(coalesce(current_setting('request.headers', true)::jsonb->>'cf-ipcountry', ''));
    exception when others then v_net := '';
    end;
    if v_net !~ '^[A-Z]{2}$' or v_net in ('XX','T1') then v_net := ''; end if;
    v_reg := upper(coalesce(v_state->>'country', ''));
    v_state := v_state || jsonb_build_object('region', v_reg, 'country', coalesce(nullif(v_net, ''), v_reg),
                                             'country_src', case when v_net <> '' then 'network' else 'setting' end);
    insert into byo.tv_devices(device_key, state) values (p_device_key, v_state)
    on conflict (device_key) do update set last_seen = now(), checkins = byo.tv_devices.checkins + 1, state = excluded.state;
    return coalesce((select flags from byo.device_flags where device_key = p_device_key), '{}'::jsonb);
end; $$;
revoke all on function public.byo_device_checkin(text,jsonb) from public;
grant execute on function public.byo_device_checkin(text,jsonb) to anon, authenticated;
