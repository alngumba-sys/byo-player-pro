-- ============================================================================
-- BYO Player Pro: see every TV and enable / disable it from the console.
--   * byo.tv_devices: each TV checks in at start-up and every 15 minutes with a small,
--     non-personal snapshot (app version, platform, model, country, language,
--     trial/subscription state, library size). No playlist links, servers, usernames
--     or passwords are ever sent.
--   * public.byo_device_checkin(): the TV's check-in; returns its flags (sections and
--     access) so support's enable/disable takes effect at the next check-in.
--   * byo_support_admin: 'fleet.list' (all TVs + summary) and 'fleet.access'
--     (enable N days / disable / end / back to normal, no help code needed).
-- Includes everything from 0008 and 0009, so running this one brings the support
-- functions fully up to date. Safe to run more than once.
-- ============================================================================

create table if not exists byo.tv_devices (
    device_key  text primary key,
    first_seen  timestamptz not null default now(),
    last_seen   timestamptz not null default now(),
    checkins    integer not null default 1,
    state       jsonb not null default '{}'::jsonb
);
create index if not exists tv_devices_last_seen on byo.tv_devices(last_seen desc);
alter table byo.tv_devices enable row level security;

create or replace function public.byo_device_checkin(p_device_key text, p_state jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare v_state jsonb := coalesce(p_state, '{}'::jsonb);
begin
    if coalesce(trim(p_device_key),'') = '' or length(p_device_key) > 120 then return jsonb_build_object('error','bad device'); end if;
    if length(v_state::text) > 6000 then v_state := '{}'::jsonb; end if;
    insert into byo.tv_devices(device_key, state) values (p_device_key, v_state)
    on conflict (device_key) do update set last_seen = now(), checkins = byo.tv_devices.checkins + 1, state = excluded.state;
    return coalesce((select flags from byo.device_flags where device_key = p_device_key), '{}'::jsonb);
end; $$;
revoke all on function public.byo_device_checkin(text,jsonb) from public;
grant execute on function public.byo_device_checkin(text,jsonb) to anon, authenticated;

-- Poll now also returns ended_by.
create or replace function public.byo_support_poll(p_session_id uuid, p_token text, p_state jsonb default null)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.support_sessions%rowtype; v_cmds jsonb;
begin
    perform byo.support_sweep();
    select * into s from byo.support_sessions where id = p_session_id;
    if not found or s.token_hash <> byo._sha(p_token) then return jsonb_build_object('error','unauthorised'); end if;
    update byo.support_sessions set last_seen = now(), device_state = coalesce(p_state, device_state) where id = s.id;
    if s.status <> 'connected' then
        return jsonb_build_object('status', s.status, 'claimed_by', s.claimed_by, 'ended_by', s.ended_by, 'commands', '[]'::jsonb, 'expires_at', s.expires_at);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'payload', q.payload || coalesce(q.secret,'{}'::jsonb)) order by q.created_at), '[]'::jsonb)
      into v_cmds
      from (select id, kind, payload, secret, created_at from byo.support_commands
             where session_id = s.id and status = 'pending' order by created_at limit 10 for update) q;
    update byo.support_commands set status = 'delivered', delivered_at = now(), secret = null
     where session_id = s.id and id in (select (e->>'id')::uuid from jsonb_array_elements(v_cmds) e);
    return jsonb_build_object('status', s.status, 'claimed_by', s.claimed_by, 'ended_by', s.ended_by, 'commands', v_cmds, 'expires_at', s.expires_at);
end; $$;
revoke all on function public.byo_support_poll(uuid,text,jsonb) from public;
grant execute on function public.byo_support_poll(uuid,text,jsonb) to anon, authenticated;

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

    -- ---------------- every TV that has checked in (no code needed) ----------------
    if p_action = 'fleet.list' then
        declare v_q text := lower(coalesce(a->>'q','')); v_f text := coalesce(a->>'filter','all');
                v_lim int := least(greatest(coalesce((a->>'limit')::int, 200), 1), 500); v_rows jsonb; v_sum jsonb;
        begin
            with base as (
                select t.device_key, t.first_seen, t.last_seen, t.checkins, t.state,
                       coalesce(f.flags->'access', 'null'::jsonb) as access,
                       coalesce(f.updated_at > t.last_seen, false) as pending,
                       (t.last_seen > now() - interval '20 minutes') as online,
                       (select ss.code from byo.support_sessions ss where ss.device_key = t.device_key and ss.status in ('waiting','connected') order by ss.created_at desc limit 1) as help_code,
                       case
                         when f.flags->'access'->>'state' = 'blocked' then 'blocked'
                         when f.flags->'access'->>'state' = 'ended' then 'expired'
                         when f.flags->'access'->>'state' = 'active' and (f.flags->'access'->>'until')::timestamptz > now() then 'enabled'
                         else coalesce(nullif(t.state->'billing'->>'state',''), 'unknown') end as status
                  from byo.tv_devices t left join byo.device_flags f on f.device_key = t.device_key),
            filt as (
                select * from base
                 where (v_q = '' or lower(device_key) like '%' || v_q || '%' or lower(coalesce(state->>'model','')) like '%' || v_q || '%'
                        or lower(coalesce(state->>'country','')) = v_q or lower(coalesce(state->>'version','')) like v_q || '%'
                        or lower(coalesce(state->>'platform','')) like '%' || v_q || '%' or upper(right(device_key, 6)) = upper(v_q))
                   and (v_f = 'all' or (v_f = 'online' and online) or status = v_f))
            select coalesce(jsonb_agg(jsonb_build_object('device_key', device_key, 'tv_id', upper(right(device_key, 6)), 'first_seen', first_seen, 'last_seen', last_seen,
                       'checkins', checkins, 'online', online, 'pending', pending, 'status', status, 'access', access, 'help_code', help_code,
                       'version', state->>'version', 'platform', state->>'platform', 'model', state->>'model', 'country', state->>'country', 'lang', state->>'lang',
                       'days_left', state->'billing'->'days_left', 'library', state->'library', 'profiles', state->'profiles') order by last_seen desc), '[]'::jsonb)
              into v_rows from (select * from filt order by last_seen desc limit v_lim) x;
            select jsonb_build_object('total', count(*), 'online', count(*) filter (where last_seen > now() - interval '20 minutes'),
                       'trial', count(*) filter (where st = 'trial'), 'active', count(*) filter (where st in ('active','enabled')),
                       'expired', count(*) filter (where st = 'expired'), 'blocked', count(*) filter (where st = 'blocked'))
              into v_sum from (
                select t.last_seen, case when f.flags->'access'->>'state' = 'blocked' then 'blocked'
                                         when f.flags->'access'->>'state' = 'ended' then 'expired'
                                         when f.flags->'access'->>'state' = 'active' and (f.flags->'access'->>'until')::timestamptz > now() then 'enabled'
                                         else coalesce(nullif(t.state->'billing'->>'state',''), 'unknown') end as st
                  from byo.tv_devices t left join byo.device_flags f on f.device_key = t.device_key) z;
            return jsonb_build_object('ok', true, 'tvs', v_rows, 'summary', v_sum, 'now', now());
        end;
    end if;

    -- enable / disable / end / clear any TV, without a help session (applied at its next check-in)
    if p_action = 'fleet.access' then
        declare v_key text := coalesce(a->>'device_key',''); v_state text := coalesce(a->>'state',''); v_d int; v_acc jsonb;
        begin
            if not exists (select 1 from byo.tv_devices where device_key = v_key) then return jsonb_build_object('ok', false, 'error', 'unknown TV'); end if;
            if v_state not in ('active','ended','blocked','clear') then return jsonb_build_object('ok', false, 'error', 'state must be active, ended, blocked or clear'); end if;
            begin v_d := coalesce((a->>'days')::int, 30); exception when others then v_d := 30; end;
            if v_state = 'active' and (v_d < 1 or v_d > 3650) then return jsonb_build_object('ok', false, 'error', 'days must be between 1 and 3650'); end if;
            v_acc := case v_state
                when 'active' then jsonb_build_object('state','active','until', now() + (v_d || ' days')::interval, 'at', now(), 'by', v_agent)
                when 'clear' then null
                else jsonb_build_object('state', v_state, 'at', now(), 'by', v_agent) end;
            insert into byo.device_flags(device_key, flags, updated_at)
            values (v_key, case when v_acc is null then '{}'::jsonb else jsonb_build_object('access', v_acc) end, now())
            on conflict (device_key) do update
               set flags = case when v_acc is null then byo.device_flags.flags - 'access' else byo.device_flags.flags || jsonb_build_object('access', v_acc) end, updated_at = now();
            -- if support happens to be connected to this TV, tell it right away too
            insert into byo.support_commands(session_id, kind, payload, created_by)
            select ss.id, 'access.set', jsonb_build_object('access', coalesce(v_acc,'{}'::jsonb), 'state', v_state, 'days', case when v_state='active' then v_d end), v_agent
              from byo.support_sessions ss where ss.device_key = v_key and ss.status = 'connected';
            insert into byo.support_audit(device_key, actor, action, detail) values (v_key, v_agent, 'fleet.access', jsonb_build_object('state', v_state, 'days', v_d));
            return jsonb_build_object('ok', true, 'device_key', v_key, 'access', v_acc);
        end;
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
