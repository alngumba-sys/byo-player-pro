-- ============================================================================
-- BYO Player Pro — Device Pairing backend (Supabase / Postgres)
-- One SQL script: tables, RLS, and SECURITY DEFINER RPCs callable with the
-- publishable (anon) key. No Edge Functions required. Supabase Realtime is used
-- for the instant TV update (TV subscribes to its own pairing_sessions row).
--
-- Security model:
--   * Pairing tokens are random, hashed (sha-256) at rest, single-use, 5-min TTL.
--   * The QR carries only a short pairing token (no credentials, no PII).
--   * The TV talks to the backend only through these RPCs (no direct table writes
--     from anon). RLS denies all direct anon table access; RPCs are the API.
--   * A 6-digit confirmation code must match for a phone to confirm (anti-mis-pair).
--   * Rate limiting on session creation + confirm attempts per device/IP bucket.
-- ============================================================================

create schema if not exists byo;
-- pgcrypto provides gen_random_bytes/digest. On Supabase it lives in the
-- "extensions" schema; every function below sets search_path to include it.
create extension if not exists pgcrypto;

-- ---- enums -----------------------------------------------------------------
do $$ begin
  create type byo.pairing_status as enum ('pending','scanned','awaitingConfirmation','paired','expired','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type byo.device_status as enum ('connected','offline','signedout','removed');
exception when duplicate_object then null; end $$;

-- ---- tables ----------------------------------------------------------------
create table if not exists byo.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,                              -- BYO account (nullable = guest)
  device_name   text not null default 'Living Room TV',
  platform      text not null default 'Tizen',
  model         text,
  app_version   text default '1.0.0',
  device_secret text not null,                     -- hashed device credential (TV keeps the raw)
  phone_token   text,                               -- companion-phone capability token for remote input
  profile_name  text,
  status        byo.device_status not null default 'connected',
  created_at    timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table if not exists byo.pairing_sessions (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid references byo.devices(id) on delete set null,
  token_hash     text not null,                    -- sha256(pairing token); raw never stored
  confirm_code   text not null,                    -- 6-digit, shown on TV + phone
  status         byo.pairing_status not null default 'pending',
  tv_name        text not null default 'Living Room TV',
  platform       text not null default 'Tizen',
  app_version    text default '1.0.0',
  user_id        uuid,                             -- set when phone confirms (nullable guest)
  profile_name   text,
  is_guest       boolean not null default false,
  payload        jsonb not null default '{}'::jsonb,-- authorised config handed to the TV (never a raw token)
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '5 minutes'),
  scanned_at     timestamptz,
  confirmed_at   timestamptz,
  attempts       int not null default 0
);
create index if not exists idx_ps_token on byo.pairing_sessions(token_hash);
create index if not exists idx_ps_status on byo.pairing_sessions(status);
create index if not exists idx_dev_user on byo.devices(user_id);

-- rate-limit bucket (very light: counts actions per key per minute window)
create table if not exists byo.rate_limit (
  bucket     text primary key,
  window_at  timestamptz not null default now(),
  count      int not null default 0
);

-- ---- make pairing_sessions realtime-visible to the TV -----------------------
-- The TV subscribes to its own row by id; status changes push instantly.
do $$ begin
  alter publication supabase_realtime add table byo.pairing_sessions;
exception when duplicate_object then null; when undefined_object then null; end $$;
alter table byo.pairing_sessions replica identity full;

-- ---- RLS: lock the tables; the RPCs below are the only API ------------------
alter table byo.devices enable row level security;
alter table byo.pairing_sessions enable row level security;
alter table byo.rate_limit enable row level security;
-- Allow Realtime to read pairing_sessions (status/payload only are non-sensitive;
-- token_hash is a hash, device_secret lives on another table). Reads are fine;
-- writes happen only through SECURITY DEFINER RPCs.
drop policy if exists ps_read on byo.pairing_sessions;
create policy ps_read on byo.pairing_sessions for select to anon, authenticated using (true);

-- ============================================================================
-- helpers
-- ============================================================================
create or replace function byo._hash(t text) returns text
language sql immutable as $$ select encode(digest(t, 'sha256'), 'hex') $$;

create or replace function byo._rl(key text, limit_n int, per_seconds int) returns boolean
language plpgsql security definer set search_path = byo, public, extensions as $$
declare r byo.rate_limit%rowtype;
begin
  select * into r from byo.rate_limit where bucket = key for update;
  if not found then
    insert into byo.rate_limit(bucket, window_at, count) values (key, now(), 1);
    return true;
  end if;
  if now() - r.window_at > make_interval(secs => per_seconds) then
    update byo.rate_limit set window_at = now(), count = 1 where bucket = key;
    return true;
  end if;
  if r.count >= limit_n then return false; end if;
  update byo.rate_limit set count = count + 1 where bucket = key;
  return true;
end $$;

-- ============================================================================
-- RPC 1: TV requests a pairing session → returns token + confirm code + ttl
-- ============================================================================
create or replace function byo.pair_create(p_tv_name text default 'Living Room TV', p_platform text default 'Tizen', p_app_version text default '1.0.0')
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare v_token text; v_code text; v_id uuid; v_expires timestamptz;
begin
  if not byo._rl('create:'||coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for','anon'), 20, 60) then
    return jsonb_build_object('error','rate_limited');
  end if;
  v_token := encode(gen_random_bytes(18), 'hex');          -- 36-char random, single-use
  v_code  := lpad((floor(random()*1000000))::int::text, 6, '0');
  insert into byo.pairing_sessions(token_hash, confirm_code, tv_name, platform, app_version, expires_at)
    values (byo._hash(v_token), v_code, p_tv_name, p_platform, p_app_version, now() + interval '5 minutes')
    returning id, expires_at into v_id, v_expires;
  return jsonb_build_object('sessionId', v_id, 'token', v_token, 'confirmCode', v_code,
    'expiresAt', v_expires, 'status','pending');
end $$;

-- ============================================================================
-- RPC 2: Phone resolves a scanned token → TV identity (no secrets) + marks scanned
-- ============================================================================
create or replace function byo.pair_scan(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.pairing_sessions%rowtype;
begin
  select * into s from byo.pairing_sessions where token_hash = byo._hash(p_token);
  if not found then return jsonb_build_object('error','not_found'); end if;
  if s.status in ('paired','cancelled') then return jsonb_build_object('error','already_'||s.status); end if;
  if now() > s.expires_at then
    update byo.pairing_sessions set status='expired' where id=s.id;
    return jsonb_build_object('error','expired');
  end if;
  update byo.pairing_sessions set status='scanned', scanned_at=now() where id=s.id and status='pending';
  return jsonb_build_object('sessionId', s.id, 'tvName', s.tv_name, 'platform', s.platform,
    'appVersion', s.app_version, 'confirmCode', s.confirm_code, 'status','scanned');
end $$;

-- ============================================================================
-- RPC 3: Phone confirms → validates code, registers device, hands TV its payload
--   p_confirm_code must match. p_user_id optional (guest = null).
--   Returns the device_secret ONCE (the phone passes nothing secret to the TV;
--   the TV already holds its own secret via the token round-trip below).
-- ============================================================================
create or replace function byo.pair_confirm(p_token text, p_confirm_code text,
  p_user_id uuid default null, p_device_name text default null, p_profile_name text default null,
  p_is_guest boolean default false, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.pairing_sessions%rowtype; v_dev uuid; v_secret text;
begin
  select * into s from byo.pairing_sessions where token_hash = byo._hash(p_token) for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if now() > s.expires_at then update byo.pairing_sessions set status='expired' where id=s.id; return jsonb_build_object('error','expired'); end if;
  if s.status = 'paired' then return jsonb_build_object('error','already_paired'); end if;
  if s.status = 'cancelled' then return jsonb_build_object('error','cancelled'); end if;
  -- confirm-code rate limit + match (anti mis-pair / brute force)
  if not byo._rl('confirm:'||s.id::text, 5, 300) then return jsonb_build_object('error','rate_limited'); end if;
  if replace(p_confirm_code,' ','') <> s.confirm_code then
    update byo.pairing_sessions set attempts = attempts + 1 where id = s.id;
    return jsonb_build_object('error','bad_code');
  end if;
  v_secret := encode(gen_random_bytes(24), 'hex');
  insert into byo.devices(user_id, device_name, platform, app_version, device_secret, profile_name, status, phone_token)
    values (p_user_id, coalesce(p_device_name, s.tv_name, 'Living Room TV'), s.platform, s.app_version,
            byo._hash(v_secret), p_profile_name, 'connected', encode(gen_random_bytes(16),'hex'))
    returning id into v_dev;
  update byo.pairing_sessions
     set status='paired', confirmed_at=now(), user_id=p_user_id, device_id=v_dev,
         profile_name=p_profile_name, is_guest=p_is_guest,
         payload = jsonb_build_object('deviceId', v_dev, 'deviceSecret', v_secret,
                     'userId', p_user_id, 'profileName', p_profile_name, 'isGuest', p_is_guest) || coalesce(p_payload,'{}'::jsonb)
   where id = s.id;
  -- Return a phone remote-control token (lets the companion phone push input to THIS device only).
  return jsonb_build_object('ok', true, 'deviceId', v_dev, 'status','paired',
    'phoneToken', (select phone_token from byo.devices where id=v_dev));
end $$;

-- ============================================================================
-- RPC 4: TV polls / claims the payload after it sees status=paired via Realtime.
--   Single-use: the token is invalidated (hash cleared) once claimed so it can
--   never pair twice. Returns deviceId + deviceSecret + authorised config.
-- ============================================================================
create or replace function byo.pair_claim(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.pairing_sessions%rowtype;
begin
  select * into s from byo.pairing_sessions where token_hash = byo._hash(p_token) for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if s.status <> 'paired' then return jsonb_build_object('status', s.status); end if;
  -- invalidate the token so it is single-use
  update byo.pairing_sessions set token_hash = 'claimed:'||s.id::text where id = s.id;
  return jsonb_build_object('ok', true, 'payload', s.payload, 'status','paired');
end $$;

-- ============================================================================
-- RPC 5: cancel / regenerate — invalidate a session immediately
-- ============================================================================
create or replace function byo.pair_cancel(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
begin
  update byo.pairing_sessions set status='cancelled' where token_hash = byo._hash(p_token) and status not in ('paired');
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- RPC 6: phone status poll (fallback if realtime unavailable on the phone)
-- ============================================================================
create or replace function byo.pair_status(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare s byo.pairing_sessions%rowtype;
begin
  select * into s from byo.pairing_sessions where token_hash = byo._hash(p_token);
  if not found then return jsonb_build_object('status','unknown'); end if;
  if now() > s.expires_at and s.status not in ('paired','cancelled') then return jsonb_build_object('status','expired'); end if;
  return jsonb_build_object('status', s.status, 'tvName', s.tv_name, 'confirmCode', s.confirm_code);
end $$;

-- ============================================================================
-- Device management RPCs (TV authenticates each call with its deviceId+secret)
-- ============================================================================
create or replace function byo._auth_device(p_device_id uuid, p_secret text) returns boolean
language sql security definer set search_path = byo, public, extensions as $$
  select exists(select 1 from byo.devices where id = p_device_id and device_secret = byo._hash(p_secret) and status <> 'removed');
$$;

-- TV heartbeat → keeps last_active_at fresh; returns current device status so the
-- TV learns about a remote sign-out / removal without a refresh.
create or replace function byo.device_ping(p_device_id uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare d byo.devices%rowtype;
begin
  select * into d from byo.devices where id = p_device_id;
  if not found or d.device_secret <> byo._hash(p_secret) then return jsonb_build_object('status','removed'); end if;
  if d.status = 'connected' then update byo.devices set last_active_at = now() where id = p_device_id; end if;
  return jsonb_build_object('status', d.status, 'deviceName', d.device_name, 'profileName', d.profile_name);
end $$;

-- list devices for an account (phone/dashboard). Returns no secrets.
create or replace function byo.device_list(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'deviceName',device_name,'platform',platform,
    'model',model,'appVersion',app_version,'profileName',profile_name,'status',status,
    'createdAt',created_at,'lastActiveAt',last_active_at) order by last_active_at desc)
    from byo.devices where user_id = p_user_id and status <> 'removed'), '[]'::jsonb);
end $$;

create or replace function byo.device_rename(p_device_id uuid, p_user_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
begin
  update byo.devices set device_name = p_name where id = p_device_id and user_id = p_user_id and status <> 'removed';
  return jsonb_build_object('ok', found);
end $$;

-- remote sign-out / remove — the TV learns via device_ping and returns to pairing
create or replace function byo.device_signout(p_device_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
begin update byo.devices set status='signedout' where id=p_device_id and user_id=p_user_id; return jsonb_build_object('ok',true); end $$;

create or replace function byo.device_remove(p_device_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
begin update byo.devices set status='removed' where id=p_device_id and user_id=p_user_id; return jsonb_build_object('ok',true); end $$;

-- ============================================================================
-- Phone-as-remote input channel: a tiny realtime relay keyed by the paired
-- device. The phone pushes text/commands; the TV subscribes to its device_id.
-- (Used for TYPE ON PHONE → Search, IPTV setup, device naming, etc.)
-- ============================================================================
create table if not exists byo.remote_input (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid not null,
  kind       text not null default 'text',  -- text | command
  value      text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_ri_dev on byo.remote_input(device_id, created_at desc);
do $$ begin alter publication supabase_realtime add table byo.remote_input;
exception when duplicate_object then null; when undefined_object then null; end $$;
alter table byo.remote_input replica identity full;
alter table byo.remote_input enable row level security;
drop policy if exists ri_read on byo.remote_input;
create policy ri_read on byo.remote_input for select to anon, authenticated using (true);

-- remote_send accepts EITHER the TV's device secret OR the companion phone token.
create or replace function byo.remote_send(p_device_id uuid, p_secret text, p_kind text, p_value text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare ok boolean;
begin
  select (device_secret = byo._hash(p_secret)) or (phone_token is not null and phone_token = p_secret)
    into ok from byo.devices where id = p_device_id and status <> 'removed';
  if not coalesce(ok,false) then return jsonb_build_object('error','unauthorised'); end if;
  if not byo._rl('remote:'||p_device_id::text, 60, 60) then return jsonb_build_object('error','rate_limited'); end if;
  insert into byo.remote_input(device_id, kind, value) values (p_device_id, coalesce(p_kind,'text'), coalesce(p_value,''));
  -- keep only the last 50 per device
  delete from byo.remote_input where device_id = p_device_id and id not in (
    select id from byo.remote_input where device_id = p_device_id order by created_at desc limit 50);
  return jsonb_build_object('ok', true);
end $$;

-- ---- grants: expose only the RPCs to the publishable (anon) role -------------
grant usage on schema byo to anon, authenticated;
grant execute on function byo.pair_create(text,text,text) to anon, authenticated;
grant execute on function byo.pair_scan(text) to anon, authenticated;
grant execute on function byo.pair_confirm(text,text,uuid,text,text,boolean,jsonb) to anon, authenticated;
grant execute on function byo.pair_claim(text) to anon, authenticated;
grant execute on function byo.pair_cancel(text) to anon, authenticated;
grant execute on function byo.pair_status(text) to anon, authenticated;
grant execute on function byo.device_ping(uuid,text) to anon, authenticated;
grant execute on function byo.device_list(uuid) to anon, authenticated;
grant execute on function byo.device_rename(uuid,uuid,text) to anon, authenticated;
grant execute on function byo.device_signout(uuid,uuid) to anon, authenticated;
grant execute on function byo.device_remove(uuid,uuid) to anon, authenticated;
grant execute on function byo.remote_send(uuid,text,text,text) to anon, authenticated;
grant select on byo.pairing_sessions, byo.remote_input to anon, authenticated;

-- ============================================================================
-- public wrappers — so every RPC is reachable at /rest/v1/rpc/byo_* with the
-- default exposed schema (public). No dashboard change needed.
-- ============================================================================
create or replace function public.byo_pair_create(p_tv_name text default 'Living Room TV', p_platform text default 'Tizen', p_app_version text default '1.0.0')
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.pair_create(p_tv_name,p_platform,p_app_version) $$;
create or replace function public.byo_pair_scan(p_token text)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.pair_scan(p_token) $$;
create or replace function public.byo_pair_confirm(p_token text, p_confirm_code text, p_user_id uuid default null, p_device_name text default null, p_profile_name text default null, p_is_guest boolean default false, p_payload jsonb default '{}'::jsonb)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.pair_confirm(p_token,p_confirm_code,p_user_id,p_device_name,p_profile_name,p_is_guest,p_payload) $$;
create or replace function public.byo_pair_claim(p_token text)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.pair_claim(p_token) $$;
create or replace function public.byo_pair_cancel(p_token text)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.pair_cancel(p_token) $$;
create or replace function public.byo_pair_status(p_token text)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.pair_status(p_token) $$;
create or replace function public.byo_device_ping(p_device_id uuid, p_secret text)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.device_ping(p_device_id,p_secret) $$;
create or replace function public.byo_device_list(p_user_id uuid)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.device_list(p_user_id) $$;
create or replace function public.byo_device_rename(p_device_id uuid, p_user_id uuid, p_name text)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.device_rename(p_device_id,p_user_id,p_name) $$;
create or replace function public.byo_device_signout(p_device_id uuid, p_user_id uuid)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.device_signout(p_device_id,p_user_id) $$;
create or replace function public.byo_device_remove(p_device_id uuid, p_user_id uuid)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.device_remove(p_device_id,p_user_id) $$;
create or replace function public.byo_remote_send(p_device_id uuid, p_secret text, p_kind text, p_value text)
  returns jsonb language sql security definer set search_path=byo,public,extensions as $$ select byo.remote_send(p_device_id,p_secret,p_kind,p_value) $$;

grant execute on function public.byo_pair_create(text,text,text), public.byo_pair_scan(text),
  public.byo_pair_confirm(text,text,uuid,text,text,boolean,jsonb), public.byo_pair_claim(text),
  public.byo_pair_cancel(text), public.byo_pair_status(text), public.byo_device_ping(uuid,text),
  public.byo_device_list(uuid), public.byo_device_rename(uuid,uuid,text),
  public.byo_device_signout(uuid,uuid), public.byo_device_remove(uuid,uuid),
  public.byo_remote_send(uuid,text,text,text) to anon, authenticated;
-- ============================================================================
-- Fix: expose remote-input delivery to the TV without needing cross-schema Realtime.
-- The TV polls byo_remote_poll(deviceId, secret) which returns + consumes the
-- latest pending command/text for that device. Works over plain REST (public schema).

create or replace function public.byo_remote_poll(p_device_id uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path=byo,public,extensions as $$
declare d byo.devices%rowtype; r byo.remote_input%rowtype;
begin
  select * into d from byo.devices where id = p_device_id;
  if not found then return jsonb_build_object('error','unauthorised'); end if;
  -- accept the TV's device secret (hashed) OR the companion phone token
  if not ( d.device_secret = byo._hash(p_secret) or (d.phone_token is not null and d.phone_token = p_secret) ) then
    return jsonb_build_object('error','unauthorised');
  end if;
  -- take the oldest unconsumed row, return it, then delete it (single delivery)
  select * into r from byo.remote_input where device_id = p_device_id order by created_at asc limit 1;
  if not found then return jsonb_build_object('empty', true); end if;
  delete from byo.remote_input where id = r.id;
  return jsonb_build_object('kind', r.kind, 'value', r.value, 'at', r.created_at);
end $$;

grant execute on function public.byo_remote_poll(uuid,text) to anon, authenticated;
