-- BYO Player Pro: Hotel mode (welcome a guest on the room TV when they are checked in).
-- Run once in the Supabase SQL editor for project lkftnbkuuitaxtlvrqfj. Safe to run again.
--
-- How it works:
--   1. Each TV is given a room code in Settings > Startup > Hotel mode, e.g. savanna-demo-101
--   2. The check-in system (later HotelierUp) calls byo_hotel_checkin(hotel, secret, room, guest name)
--   3. The TV polls byo_hotel_poll(room code) every few seconds, wakes up and shows the welcome page.

create schema if not exists byo;

create table if not exists byo.hotels (
  code        text primary key,                 -- e.g. savanna-demo
  name        text not null,
  secret      text not null,                    -- the check-in system must send this
  created_at  timestamptz not null default now()
);

create table if not exists byo.hotel_events (
  id           bigserial primary key,
  room         text not null,                   -- full room code, e.g. savanna-demo-101
  guest_name   text not null default '',
  created_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists hotel_events_room_idx on byo.hotel_events (room, delivered_at, created_at);

alter table byo.hotels enable row level security;
alter table byo.hotel_events enable row level security;   -- no policies: only the functions below can touch them

-- Demo hotel. The secret is generated here; read it with:  select code, secret from byo.hotels;
insert into byo.hotels (code, name, secret)
values ('savanna-demo', 'Savanna Demo Resort', md5(random()::text || clock_timestamp()::text))
on conflict (code) do nothing;

-- Called by the check-in system.
create or replace function public.byo_hotel_checkin(p_hotel text, p_secret text, p_room text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, byo as $$
declare h byo.hotels; rc text;
begin
  select * into h from byo.hotels where code = lower(trim(p_hotel));
  if h.code is null or h.secret <> p_secret then
    return jsonb_build_object('ok', false, 'error', 'not allowed');
  end if;
  rc := lower(h.code || '-' || regexp_replace(trim(p_room), '[^A-Za-z0-9]+', '', 'g'));
  insert into byo.hotel_events (room, guest_name) values (rc, left(coalesce(p_name, ''), 40));
  return jsonb_build_object('ok', true, 'room', rc);
end $$;

-- Called by the TV. Returns the oldest waiting welcome (from the last 10 minutes) once, or null.
create or replace function public.byo_hotel_poll(p_room text)
returns jsonb language plpgsql security definer set search_path = public, byo as $$
declare e byo.hotel_events;
begin
  update byo.hotel_events set delivered_at = now()
   where id = (select id from byo.hotel_events
                where room = lower(trim(p_room)) and delivered_at is null
                  and created_at > now() - interval '10 minutes'
                order by id limit 1 for update skip locked)
  returning * into e;
  if e.id is null then return null; end if;
  return jsonb_build_object('name', e.guest_name);
end $$;

grant execute on function public.byo_hotel_checkin(text, text, text, text) to anon, authenticated;
grant execute on function public.byo_hotel_poll(text) to anon, authenticated;
