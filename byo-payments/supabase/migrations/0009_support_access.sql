-- ============================================================================
-- BYO Player Pro: remote support, round 3 - access control.
--   support.access {session_id, state, days?}
--     state 'active'  : enable full access for N days (default 30)
--     state 'ended'   : end the trial / subscription now (the TV shows the Subscribe screen)
--     state 'blocked' : block BYO Player on this TV (a "paused by support" screen)
--     state 'clear'   : back to normal (unblock / undo)
--   The choice is stored in byo.device_flags.flags.access, so the TV applies it at
--   every start-up, not only while a help session is open.
--   Saving app sections now keeps the access setting.
-- Requires 0006, 0007 and 0008. Safe to run more than once.
-- ============================================================================

create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare
    a jsonb := coalesce(p_args, '{}'::jsonb);
    v_agent text := left(coalesce(nullif(trim(a->>'agent'), ''), 'support'), 60);
    v_id uuid; s byo.support_sessions%rowtype; v_code text; v_kind text; v_days int; v_flags jsonb := '{}'::jsonb;
    k text; v_out jsonb;
begin
    perform byo.support_sweep();

    if p_action = 'support.recent' then
        select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_out from (
            select jsonb_build_object('id', id, 'code', code, 'status', status, 'claimed_by', claimed_by, 'created_at', created_at,
                   'claimed_at', claimed_at, 'ended_at', ended_at, 'ended_by', ended_by, 'device_key', device_key,
                   'device_state', jsonb_build_object('version', device_state->>'version', 'platform', device_state->>'platform', 'model', device_state->>'model')) x
              from byo.support_sessions order by created_at desc limit least(coalesce((a->>'limit')::int, 20), 100)) t;
        return jsonb_build_object('ok', true, 'sessions', v_out);
    end if;

    -- every session support is connected to right now, soonest to expire first
    if p_action = 'support.active' then
        select coalesce(jsonb_agg(x order by (x->>'expires_at')), '[]'::jsonb) into v_out from (
            select jsonb_build_object('id', ss.id, 'code', ss.code, 'status', ss.status, 'claimed_by', ss.claimed_by, 'claimed_at', ss.claimed_at,
                   'expires_at', ss.expires_at, 'last_seen', ss.last_seen, 'device_key', ss.device_key,
                   'device_state', jsonb_build_object('version', ss.device_state->>'version', 'platform', ss.device_state->>'platform',
                        'model', ss.device_state->>'model', 'country', ss.device_state->>'country'),
                   'pending', (select count(*) from byo.support_commands c where c.session_id = ss.id and c.status in ('pending','delivered')),
                   'errors', (select count(*) from byo.support_commands c where c.session_id = ss.id and c.status = 'error')) x
              from byo.support_sessions ss where ss.status = 'connected') t;
        return jsonb_build_object('ok', true, 'sessions', v_out, 'now', now());
    end if;

    if p_action = 'support.claim' then
        v_code := regexp_replace(coalesce(a->>'code', ''), '\D', '', 'g');
        if length(v_code) <> 4 then return jsonb_build_object('ok', false, 'error', 'enter the 4-digit code shown on the TV'); end if;
        select * into s from byo.support_sessions where code = v_code and status in ('waiting','connected') limit 1;
        if not found then return jsonb_build_object('ok', false, 'error', 'no TV is waiting with that code (it may have expired)'); end if;
        if s.status = 'waiting' then
            update byo.support_sessions set status = 'connected', claimed_at = now(), claimed_by = v_agent, expires_at = now() + interval '60 minutes'
             where id = s.id and status = 'waiting';
            insert into byo.support_audit(session_id, device_key, actor, action, detail) values (s.id, s.device_key, v_agent, 'claim', jsonb_build_object('code', v_code));
        end if;
        return byo._support_view(s.id);
    end if;

    -- everything below works on an existing session
    begin v_id := (a->>'session_id')::uuid; exception when others then v_id := null; end;
    if v_id is null then return jsonb_build_object('ok', false, 'error', 'session_id required'); end if;
    select * into s from byo.support_sessions where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'session not found'); end if;

    if p_action = 'support.status' then
        return byo._support_view(s.id);
    end if;

    if p_action = 'support.end' then
        update byo.support_sessions set status = case when status = 'waiting' then 'expired' else 'ended' end, ended_at = now(), ended_by = v_agent
         where id = s.id and status in ('waiting','connected');
        update byo.support_commands set secret = null, status = case when status = 'pending' then 'cancelled' else status end where session_id = s.id;
        insert into byo.support_audit(session_id, device_key, actor, action) values (s.id, s.device_key, v_agent, 'end');
        return byo._support_view(s.id);
    end if;

    if s.status <> 'connected' then
        return jsonb_build_object('ok', false, 'error', 'session is not connected (' || s.status || ')');
    end if;

    -- more time to finish: +30 minutes, at most 3 hours after support connected
    if p_action = 'support.extend' then
        update byo.support_sessions
           set expires_at = least(expires_at + interval '30 minutes', coalesce(claimed_at, now()) + interval '3 hours')
         where id = s.id;
        insert into byo.support_audit(session_id, device_key, actor, action) values (s.id, s.device_key, v_agent, 'extend');
        return byo._support_view(s.id);
    end if;

    if p_action = 'support.send' then
        v_kind := coalesce(a->>'kind', '');
        if v_kind not in ('connection.add','connection.remove','settings','message','refresh','signout','billing.refresh','flags','trial.add') then
            return jsonb_build_object('ok', false, 'error', 'unknown command ' || v_kind);
        end if;
        insert into byo.support_commands(session_id, kind, payload, secret, created_by)
        values (s.id, v_kind, coalesce(a->'payload', '{}'::jsonb), nullif(a->'secret', 'null'::jsonb), v_agent);
        insert into byo.support_audit(session_id, device_key, actor, action, detail)
        values (s.id, s.device_key, v_agent, 'send', jsonb_build_object('kind', v_kind, 'payload', coalesce(a->'payload', '{}'::jsonb), 'has_secret', (a->'secret') is not null and a->'secret' <> 'null'::jsonb));
        return byo._support_view(s.id);
    end if;

    if p_action = 'support.trial' then
        begin v_days := (a->>'days')::int; exception when others then v_days := 0; end;
        if coalesce(v_days, 0) = 0 or v_days < -60 or v_days > 365 then
            return jsonb_build_object('ok', false, 'error', 'days must be between -60 and 365');
        end if;
        -- server trial clock (only if the billing tables are installed and this TV is registered)
        begin
            update byo.devices set trial_bonus_days = coalesce(trial_bonus_days, 0) + v_days where device_id = s.device_key;
        exception when others then null;
        end;
        -- the TV keeps its own trial clock as well: tell it directly
        insert into byo.support_commands(session_id, kind, payload, created_by) values (s.id, 'trial.add', jsonb_build_object('days', v_days), v_agent);
        insert into byo.support_audit(session_id, device_key, actor, action, detail) values (s.id, s.device_key, v_agent, 'trial', jsonb_build_object('days', v_days));
        return byo._support_view(s.id);
    end if;

    -- access: 'active' (enable for N days), 'ended' (end trial/subscription now), 'blocked', 'clear' (back to normal)
    if p_action = 'support.access' then
        v_kind := coalesce(a->>'state', '');
        if v_kind not in ('active','ended','blocked','clear') then
            return jsonb_build_object('ok', false, 'error', 'state must be active, ended, blocked or clear');
        end if;
        begin v_days := coalesce((a->>'days')::int, 30); exception when others then v_days := 30; end;
        if v_kind = 'active' and (v_days < 1 or v_days > 3650) then return jsonb_build_object('ok', false, 'error', 'days must be between 1 and 3650'); end if;
        v_out := case v_kind
            when 'active'  then jsonb_build_object('state', 'active', 'until', now() + (v_days || ' days')::interval, 'at', now(), 'by', v_agent)
            when 'clear'   then null
            else jsonb_build_object('state', v_kind, 'at', now(), 'by', v_agent) end;
        insert into byo.device_flags(device_key, flags, updated_at)
        values (s.device_key, case when v_out is null then '{}'::jsonb else jsonb_build_object('access', v_out) end, now())
        on conflict (device_key) do update
           set flags = case when v_out is null then byo.device_flags.flags - 'access' else byo.device_flags.flags || jsonb_build_object('access', v_out) end,
               updated_at = now();
        insert into byo.support_commands(session_id, kind, payload, created_by)
        values (s.id, 'access.set', jsonb_build_object('access', coalesce(v_out, '{}'::jsonb), 'state', v_kind, 'days', case when v_kind = 'active' then v_days end), v_agent);
        insert into byo.support_audit(session_id, device_key, actor, action, detail) values (s.id, s.device_key, v_agent, 'access', jsonb_build_object('state', v_kind, 'days', v_days));
        return byo._support_view(s.id);
    end if;

    if p_action = 'support.flags' then
        for k in select jsonb_object_keys(coalesce(a->'flags', '{}'::jsonb)) loop
            if k in ('live','sports','movies','series','guide','assistant') then
                v_flags := v_flags || jsonb_build_object(k, coalesce((a->'flags'->>k)::boolean, true));
            end if;
        end loop;
        insert into byo.device_flags(device_key, flags, updated_at) values (s.device_key, v_flags, now())
        on conflict (device_key) do update
           set flags = (byo.device_flags.flags - array['live','sports','movies','series','guide','assistant']) || excluded.flags, updated_at = now();
        insert into byo.support_commands(session_id, kind, payload, created_by) values (s.id, 'flags', jsonb_build_object('flags', v_flags), v_agent);
        insert into byo.support_audit(session_id, device_key, actor, action, detail) values (s.id, s.device_key, v_agent, 'flags', v_flags);
        return byo._support_view(s.id);
    end if;

    return jsonb_build_object('ok', false, 'error', 'unknown action ' || coalesce(p_action, ''));
end; $$;

-- Only the service role (used by the admin Edge Function) may call it.
revoke all on function public.byo_support_admin(text, jsonb) from public;
revoke all on function public.byo_support_admin(text, jsonb) from anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;
revoke all on function byo._support_view(uuid) from public;
