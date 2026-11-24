-- BYO Player Pro: Hotel welcome screen settings + guest requests.
-- Run once in the Supabase SQL editor for project lkftnbkuuitaxtlvrqfj (after 0005_hotel_mode.sql). Safe to run again.
--
--  * byo.hotels.config      : look and content of the welcome screen (logo, background, texts, Wi-Fi ...), set from HotelierUp
--  * byo_hotel_set_config   : HotelierUp saves the config (needs the hotel secret)
--  * byo_hotel_get_config   : the TV reads the config for its room (no secrets in it)
--  * byo_hotel_request      : the TV sends a guest request (housekeeping, wake-up call, checkout ...)
--  * byo_hotel_list_requests / byo_hotel_close_request : HotelierUp reads and closes them (needs the hotel secret)

alter table byo.hotels add column if not exists config jsonb not null default '{}'::jsonb;

create table if not exists byo.hotel_requests (
  id          bigserial primary key,
  hotel       text not null,
  room        text not null,            -- full room code, e.g. savanna-demo-101
  kind        text not null,            -- services | dining | checkout | other
  note        text not null default '',
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists hotel_requests_open_idx on byo.hotel_requests (hotel, closed_at, created_at);
alter table byo.hotel_requests enable row level security;   -- no policies: only the functions below can touch it

create or replace function public.byo_hotel_set_config(p_hotel text, p_secret text, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public, byo as $$
declare h byo.hotels;
begin
  select * into h from byo.hotels where code = lower(trim(p_hotel));
  if h.code is null or h.secret <> p_secret then return jsonb_build_object('ok', false, 'error', 'not allowed'); end if;
  if octet_length(coalesce(p_config, '{}'::jsonb)::text) > 3000000 then
    return jsonb_build_object('ok', false, 'error', 'too large (3 MB max)'); end if;
  update byo.hotels set config = coalesce(p_config, '{}'::jsonb) where code = h.code;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.byo_hotel_get_config(p_room text)
returns jsonb language plpgsql security definer set search_path = public, byo as $$
declare hc text; h byo.hotels;
begin
  hc := regexp_replace(lower(trim(p_room)), '-[^-]*$', '');      -- savanna-demo-101  ->  savanna-demo
  select * into h from byo.hotels where code = hc;
  if h.code is null then return null; end if;
  return coalesce(h.config, '{}'::jsonb) || jsonb_build_object('hotelCode', h.code, 'hotelName', coalesce(nullif(h.config->>'hotelName',''), h.name));
end $$;

create or replace function public.byo_hotel_request(p_room text, p_kind text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, byo as $$
declare hc text; h byo.hotels; rc text; recent int;
begin
  rc := lower(trim(p_room));
  hc := regexp_replace(rc, '-[^-]*$', '');
  select * into h from byo.hotels where code = hc;
  if h.code is null then return jsonb_build_object('ok', false, 'error', 'unknown room'); end if;
  select count(*) into recent from byo.hotel_requests where room = rc and created_at > now() - interval '1 minute';
  if recent >= 5 then return jsonb_build_object('ok', false, 'error', 'slow down'); end if;
  insert into byo.hotel_requests (hotel, room, kind, note)
  values (h.code, rc, left(coalesce(nullif(trim(p_kind), ''), 'other'), 20), left(coalesce(p_note, ''), 200));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.byo_hotel_list_requests(p_hotel text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public, byo as $$
declare h byo.hotels;
begin
  select * into h from byo.hotels where code = lower(trim(p_hotel));
  if h.code is null or h.secret <> p_secret then return jsonb_build_object('ok', false, 'error', 'not allowed'); end if;
  return jsonb_build_object('ok', true, 'requests', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'room', r.room, 'kind', r.kind, 'note', r.note, 'at', r.created_at, 'closed', r.closed_at is not null) order by r.id desc)
      from (select * from byo.hotel_requests where hotel = h.code order by id desc limit 100) r), '[]'::jsonb));
end $$;

create or replace function public.byo_hotel_close_request(p_hotel text, p_secret text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, byo as $$
declare h byo.hotels;
begin
  select * into h from byo.hotels where code = lower(trim(p_hotel));
  if h.code is null or h.secret <> p_secret then return jsonb_build_object('ok', false, 'error', 'not allowed'); end if;
  update byo.hotel_requests set closed_at = now() where id = p_id and hotel = h.code and closed_at is null;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.byo_hotel_set_config(text, text, jsonb) to anon, authenticated;
grant execute on function public.byo_hotel_get_config(text) to anon, authenticated;
grant execute on function public.byo_hotel_request(text, text, text) to anon, authenticated;
grant execute on function public.byo_hotel_list_requests(text, text) to anon, authenticated;
grant execute on function public.byo_hotel_close_request(text, text, bigint) to anon, authenticated;
