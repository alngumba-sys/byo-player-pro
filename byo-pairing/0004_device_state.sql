-- BYO Player: TV -> phone status channel.
-- The TV reports which connections it has, which are active, and how each one
-- the phone sent loaded. The phone (holding its pairing phone token) reads it.
-- Additive only: one new table and two functions. Safe to run more than once.

create table if not exists byo.device_state (
  device_id  uuid primary key references byo.devices(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table byo.device_state enable row level security;   -- no policies: reachable only through the functions below

-- TV writes its state (authenticated with its device secret).
create or replace function public.byo_device_report(p_device_id uuid, p_secret text, p_state jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
begin
  if not byo._auth_device(p_device_id, p_secret) then return jsonb_build_object('error','unauthorised'); end if;
  if length(coalesce(p_state,'{}'::jsonb)::text) > 20000 then return jsonb_build_object('error','too_large'); end if;
  if not byo._rl('report:'||p_device_id::text, 120, 60) then return jsonb_build_object('error','rate_limited'); end if;
  insert into byo.device_state(device_id, state, updated_at) values (p_device_id, coalesce(p_state,'{}'::jsonb), now())
  on conflict (device_id) do update set state = excluded.state, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Phone (phone token) or TV (device secret) reads it.
create or replace function public.byo_device_state(p_device_id uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare d byo.devices%rowtype; s byo.device_state%rowtype;
begin
  select * into d from byo.devices where id = p_device_id and status <> 'removed';
  if not found then return jsonb_build_object('error','unauthorised'); end if;
  if not ( d.device_secret = byo._hash(p_secret) or (d.phone_token is not null and d.phone_token = p_secret) ) then
    return jsonb_build_object('error','unauthorised');
  end if;
  select * into s from byo.device_state where device_id = p_device_id;
  if not found then return jsonb_build_object('empty', true); end if;
  return jsonb_build_object('state', s.state, 'updatedAt', s.updated_at);
end $$;

grant execute on function public.byo_device_report(uuid,text,jsonb), public.byo_device_state(uuid,text) to anon, authenticated;
notify pgrst, 'reload schema';
