-- ============================================================================
-- BYO Player Pro: remote support ("Get remote help").
--
-- Flow
--   1. On the TV: Settings > Connection > Get remote help. The TV calls
--      public.byo_support_open() and shows a 4-digit code.
--   2. The customer reads the code to support. The admin console calls the
--      `admin` Edge Function (support.claim) with that code and gets the session.
--   3. Support queues commands (add/remove a connection, settings, message,
--      trial days, feature switches, refresh, sign out). The TV polls
--      public.byo_support_poll() every few seconds while help is open, applies
--      each command, and reports back with public.byo_support_ack().
--   4. Either side can end the session. Codes expire after 15 minutes if
--      nobody connects; a connected session ends after 60 minutes.
--
-- Safety
--   * Nothing happens unless the customer opens help on the TV and shares the code.
--   * The TV holds a random session token; every poll/ack must present it.
--   * Credentials for a connection are kept in support_commands.secret only until
--     the TV collects them, then wiped. Ended sessions wipe anything left.
--   * Every admin action is written to support_audit.
--   * Tables have RLS on and no policies: only the SECURITY DEFINER functions
--     below and the service-role Edge Function can touch them.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists byo.support_sessions (
    id           uuid primary key default gen_random_uuid(),
    device_key   text not null,                          -- the app's billing device id
    code         text not null,                          -- 4 digits shown on the TV
    token_hash   text not null,                          -- sha256 of the TV's session token
    status       text not null default 'waiting' check (status in ('waiting','connected','ended','expired')),
    device_state jsonb not null default '{}'::jsonb,     -- latest snapshot reported by the TV (no passwords)
    claimed_by   text,
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null default now() + interval '15 minutes',
    claimed_at   timestamptz,
    ended_at     timestamptz,
    ended_by     text,
    last_seen    timestamptz not null default now()
);
create unique index if not exists support_sessions_live_code on byo.support_sessions(code) where status in ('waiting','connected');
create index if not exists support_sessions_device on byo.support_sessions(device_key, created_at desc);
alter table byo.support_sessions enable row level security;

create table if not exists byo.support_commands (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references byo.support_sessions(id) on delete cascade,
    kind         text not null,
    payload      jsonb not null default '{}'::jsonb,     -- what the dashboard shows (never secrets)
    secret       jsonb,                                  -- e.g. a password; wiped once delivered
    status       text not null default 'pending' check (status in ('pending','delivered','done','error','cancelled')),
    result       text,
    created_by   text,
    created_at   timestamptz not null default now(),
    delivered_at timestamptz,
    finished_at  timestamptz
);
create index if not exists support_commands_session on byo.support_commands(session_id, created_at);
alter table byo.support_commands enable row level security;

create table if not exists byo.support_audit (
    id          bigserial primary key,
    session_id  uuid,
    device_key  text,
    actor       text,
    action      text not null,
    detail      jsonb,
    at          timestamptz not null default now()
);
alter table byo.support_audit enable row level security;

-- Feature switches per device (support can turn parts of the app on or off).
create table if not exists byo.device_flags (
    device_key  text primary key,
    flags       jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now()
);
alter table byo.device_flags enable row level security;

-- Extra free days granted by support, on top of app_config.trial_days.
alter table byo.devices add column if not exists trial_bonus_days integer not null default 0;

create or replace function byo.billing_status(p_device_id text)
returns table(state text, trial_ends_at timestamptz, sub_expires_at timestamptz)
language plpgsql security definer set search_path = byo as $$
declare v_trial_end timestamptz; v_sub timestamptz;
begin
    select d.trial_started_at + ((byo.trial_days() + coalesce(d.trial_bonus_days,0)) || ' days')::interval
      into v_trial_end from byo.devices d where d.device_id = p_device_id;
    select s.expires_at into v_sub from byo.subscriptions s where s.device_id = p_device_id and s.status = 'active';
    return query select
        case when v_sub is not null and v_sub > now() then 'active'
             when v_trial_end is not null and v_trial_end > now() then 'trial'
             else 'expired' end,
        v_trial_end, v_sub;
end; $$;

-- ---------- helpers ----------
create or replace function byo._sha(t text) returns text language sql immutable set search_path = byo, public, extensions as $$
    select encode(digest(coalesce(t,''), 'sha256'), 'hex');
$$;

-- Close sessions that ran out of time and wipe any undelivered secrets.
create or replace function byo.support_sweep() returns void
language plpgsql security definer set search_path = byo as $$
begin
    update byo.support_sessions set status = case when status='waiting' then 'expired' else 'ended' end,
           ended_at = now(), ended_by = coalesce(ended_by,'timeout')
     where status in ('waiting','connected') and expires_at < now();
    update byo.support_commands c set secret = null,
           status = case when c.status in ('pending','delivered') then 'cancelled' else c.status end
      from byo.support_sessions s
     where c.session_id = s.id and s.status in ('ended','expired') and (c.secret is not null or c.status in ('pending','delivered'));
end; $$;

-- ---------- TV side (anon, via RPC) ----------

-- Open a help session: returns the code to show and a token only this TV knows.
create or replace function public.byo_support_open(p_device_key text, p_state jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare v_code text; v_token text; v_id uuid; v_tries int := 0; v_recent int;
begin
    if coalesce(trim(p_device_key),'') = '' or length(p_device_key) > 120 then return jsonb_build_object('error','bad device'); end if;
    perform byo.support_sweep();
    -- at most 6 codes per device per hour
    select count(*) into v_recent from byo.support_sessions where device_key = p_device_key and created_at > now() - interval '1 hour';
    if v_recent >= 6 then return jsonb_build_object('error','too many requests, try again later'); end if;
    -- one open session per TV
    update byo.support_sessions set status = case when status='waiting' then 'expired' else 'ended' end, ended_at = now(), ended_by = 'reopened'
     where device_key = p_device_key and status in ('waiting','connected');
    loop
        v_code := lpad((floor(random()*10000))::int::text, 4, '0');
        exit when not exists (select 1 from byo.support_sessions where code = v_code and status in ('waiting','connected'));
        v_tries := v_tries + 1; if v_tries > 40 then return jsonb_build_object('error','busy, try again'); end if;
    end loop;
    v_token := encode(gen_random_bytes(24), 'hex');
    insert into byo.support_sessions(device_key, code, token_hash, device_state)
    values (p_device_key, v_code, byo._sha(v_token), coalesce(p_state,'{}'::jsonb))
    returning id into v_id;
    insert into byo.support_audit(session_id, device_key, actor, action) values (v_id, p_device_key, 'tv', 'open');
    return jsonb_build_object('session_id', v_id, 'code', v_code, 'token', v_token, 'expires_at', now() + interval '15 minutes');
end; $$;

-- Poll: report the TV's state, learn the session status, collect commands (each delivered once).
create or replace function public.byo_support_poll(p_session_id uuid, p_token text, p_state jsonb default null)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.support_sessions%rowtype; v_cmds jsonb;
begin
    perform byo.support_sweep();
    select * into s from byo.support_sessions where id = p_session_id;
    if not found or s.token_hash <> byo._sha(p_token) then return jsonb_build_object('error','unauthorised'); end if;
    update byo.support_sessions set last_seen = now(), device_state = coalesce(p_state, device_state) where id = s.id;
    if s.status <> 'connected' then
        return jsonb_build_object('status', s.status, 'claimed_by', s.claimed_by, 'commands', '[]'::jsonb, 'expires_at', s.expires_at);
    end if;
    -- take up to 10 pending commands (with their secrets), then mark them delivered and wipe the secrets
    select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'payload', q.payload || coalesce(q.secret,'{}'::jsonb)) order by q.created_at), '[]'::jsonb)
      into v_cmds
      from (select id, kind, payload, secret, created_at from byo.support_commands
             where session_id = s.id and status = 'pending' order by created_at limit 10 for update) q;
    update byo.support_commands set status = 'delivered', delivered_at = now(), secret = null
     where session_id = s.id and id in (select (e->>'id')::uuid from jsonb_array_elements(v_cmds) e);
    return jsonb_build_object('status', s.status, 'claimed_by', s.claimed_by, 'commands', v_cmds, 'expires_at', s.expires_at);
end; $$;

-- Ack: the TV says how a command went.
create or replace function public.byo_support_ack(p_session_id uuid, p_token text, p_command_id uuid, p_ok boolean, p_result text default null)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.support_sessions%rowtype;
begin
    select * into s from byo.support_sessions where id = p_session_id;
    if not found or s.token_hash <> byo._sha(p_token) then return jsonb_build_object('error','unauthorised'); end if;
    update byo.support_commands set status = case when p_ok then 'done' else 'error' end, result = left(coalesce(p_result,''), 400), finished_at = now(), secret = null
     where id = p_command_id and session_id = s.id;
    return jsonb_build_object('ok', true);
end; $$;

-- End: the customer pressed End on the TV.
create or replace function public.byo_support_end(p_session_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.support_sessions%rowtype;
begin
    select * into s from byo.support_sessions where id = p_session_id;
    if not found or s.token_hash <> byo._sha(p_token) then return jsonb_build_object('error','unauthorised'); end if;
    update byo.support_sessions set status = case when status='waiting' then 'expired' else 'ended' end, ended_at = now(), ended_by = 'tv'
     where id = s.id and status in ('waiting','connected');
    update byo.support_commands set secret = null, status = case when status in ('pending','delivered') then 'cancelled' else status end where session_id = s.id;
    insert into byo.support_audit(session_id, device_key, actor, action) values (s.id, s.device_key, 'tv', 'end');
    return jsonb_build_object('ok', true);
end; $$;

-- Feature switches for this TV (read at start-up; not secret).
create or replace function public.byo_device_flags(p_device_key text)
returns jsonb language sql security definer set search_path = byo, public as $$
    select coalesce((select flags from byo.device_flags where device_key = p_device_key), '{}'::jsonb);
$$;

revoke all on function public.byo_support_open(text,jsonb) from public;
revoke all on function public.byo_support_poll(uuid,text,jsonb) from public;
revoke all on function public.byo_support_ack(uuid,text,uuid,boolean,text) from public;
revoke all on function public.byo_support_end(uuid,text) from public;
revoke all on function public.byo_device_flags(text) from public;
grant execute on function public.byo_support_open(text,jsonb) to anon, authenticated;
grant execute on function public.byo_support_poll(uuid,text,jsonb) to anon, authenticated;
grant execute on function public.byo_support_ack(uuid,text,uuid,boolean,text) to anon, authenticated;
grant execute on function public.byo_support_end(uuid,text) to anon, authenticated;
grant execute on function public.byo_device_flags(text) to anon, authenticated;
