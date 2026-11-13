-- ============================================================================
-- Sales referrals: salespeople get a code and a login; customers type the code in the app;
-- each salesperson sees only their own customers, the days each was active, and commission.
--   byo.sales_agents / byo.sales_sessions / byo.referrals / byo.device_activity
--   public.byo_referral_claim(device_key, code)       (the app)
--   public.byo_sales_login(email, password)           (sales portal /sales/)
--   public.byo_sales_me(token)                         (sales portal)
--   public.byo_sales_logout(token)
--   fleet.sales_list / fleet.sales_save  (support console, via byo_support_admin; password reset is sales_save with a password)
--   byo_device_checkin now records one row per device per day (Nairobi date) in byo.device_activity.
-- Safe to run more than once.
-- ============================================================================
create table if not exists byo.sales_agents (
    id uuid primary key default gen_random_uuid(),
    name text not null, email text not null, code text not null,
    pct numeric not null default 10 check (pct >= 0 and pct <= 100),
    pass_hash text not null, active boolean not null default true,
    fails int not null default 0, last_fail timestamptz, last_login timestamptz,
    created_at timestamptz not null default now()
);
create unique index if not exists sales_agents_email on byo.sales_agents (lower(email));
create unique index if not exists sales_agents_code on byo.sales_agents (upper(code));
create table if not exists byo.sales_sessions (
    token_hash text primary key, agent_id uuid not null references byo.sales_agents(id) on delete cascade,
    expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists byo.referrals (
    device_key text primary key, agent_id uuid not null references byo.sales_agents(id) on delete restrict,
    code text not null, referred_at timestamptz not null default now()
);
create index if not exists referrals_agent on byo.referrals (agent_id, referred_at desc);
create table if not exists byo.device_activity (
    device_key text not null, day date not null, primary key (device_key, day)
);
alter table byo.sales_agents enable row level security;
alter table byo.sales_sessions enable row level security;
alter table byo.referrals enable row level security;
alter table byo.device_activity enable row level security;

-- start recording activity days (and backfill what we know)
insert into byo.device_activity(device_key, day)
select device_key, (first_seen at time zone 'Africa/Nairobi')::date from byo.tv_devices on conflict do nothing;
insert into byo.device_activity(device_key, day)
select device_key, (last_seen at time zone 'Africa/Nairobi')::date from byo.tv_devices on conflict do nothing;

create or replace function public.byo_device_checkin(p_device_key text, p_state jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare v_state jsonb := coalesce(p_state, '{}'::jsonb);
begin
    if coalesce(trim(p_device_key),'') = '' or length(p_device_key) > 120 then return jsonb_build_object('error','bad device'); end if;
    if length(v_state::text) > 6000 then v_state := '{}'::jsonb; end if;
    insert into byo.tv_devices(device_key, state) values (p_device_key, v_state)
    on conflict (device_key) do update set last_seen = now(), checkins = byo.tv_devices.checkins + 1, state = excluded.state;
    insert into byo.device_activity(device_key, day) values (p_device_key, (now() at time zone 'Africa/Nairobi')::date) on conflict do nothing;
    return coalesce((select flags from byo.device_flags where device_key = p_device_key), '{}'::jsonb)
           || jsonb_build_object('referred', exists(select 1 from byo.referrals where device_key = p_device_key));
end; $$;
revoke all on function public.byo_device_checkin(text,jsonb) from public;
grant execute on function public.byo_device_checkin(text,jsonb) to anon, authenticated;

-- The app: a customer types a salesperson's code. One code per device, within 30 days of first use.
create or replace function public.byo_referral_claim(p_device_key text, p_code text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents%rowtype; v_first timestamptz; v_have text; v_code text := upper(trim(coalesce(p_code,'')));
begin
    if coalesce(trim(p_device_key),'') = '' or length(p_device_key) > 120 or v_code = '' or length(v_code) > 20 then return jsonb_build_object('ok', false, 'error', 'Enter the code your salesperson gave you.'); end if;
    select code into v_have from byo.referrals where device_key = p_device_key;
    if found then return jsonb_build_object('ok', true, 'already', true); end if;
    select * into a from byo.sales_agents where upper(code) = v_code and active;
    if not found then return jsonb_build_object('ok', false, 'error', 'That code is not valid. Check it and try again.'); end if;
    select first_seen into v_first from byo.tv_devices where device_key = p_device_key;
    if not found then return jsonb_build_object('ok', false, 'error', 'Please try again in a minute.'); end if;
    if v_first < now() - interval '30 days' then return jsonb_build_object('ok', false, 'error', 'Codes can only be added in the first 30 days.'); end if;
    insert into byo.referrals(device_key, agent_id, code) values (p_device_key, a.id, a.code) on conflict do nothing;
    return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.byo_referral_claim(text,text) from public;
grant execute on function public.byo_referral_claim(text,text) to anon, authenticated;

-- Sales portal sign-in
create or replace function public.byo_sales_login(p_email text, p_password text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents%rowtype; v_tok text;
begin
    select * into a from byo.sales_agents where lower(email) = lower(trim(coalesce(p_email,'')));
    if not found then perform pg_sleep(0.4); return jsonb_build_object('ok', false, 'error', 'Wrong email or password.'); end if;
    if a.fails >= 8 and a.last_fail > now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'error', 'Too many tries. Wait 15 minutes and try again.'); end if;
    if not a.active or a.pass_hash <> crypt(coalesce(p_password,''), a.pass_hash) then
        update byo.sales_agents set fails = case when last_fail > now() - interval '15 minutes' then fails + 1 else 1 end, last_fail = now() where id = a.id;
        return jsonb_build_object('ok', false, 'error', case when a.active then 'Wrong email or password.' else 'This account is switched off.' end);
    end if;
    v_tok := encode(gen_random_bytes(32), 'hex');
    insert into byo.sales_sessions(token_hash, agent_id, expires_at) values (encode(digest(v_tok, 'sha256'), 'hex'), a.id, now() + interval '30 days');
    delete from byo.sales_sessions where expires_at < now();
    update byo.sales_agents set fails = 0, last_login = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', v_tok);
end; $$;
revoke all on function public.byo_sales_login(text,text) from public;
grant execute on function public.byo_sales_login(text,text) to anon, authenticated;

create or replace function public.byo_sales_logout(p_token text)
returns jsonb language sql security definer set search_path = byo, public, extensions as $$
    with d as (delete from byo.sales_sessions where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') returning 1) select jsonb_build_object('ok', true);
$$;
revoke all on function public.byo_sales_logout(text) from public;
grant execute on function public.byo_sales_logout(text) to anon, authenticated;

-- Everything one salesperson may see: their own customers only
create or replace function public.byo_sales_me(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents%rowtype; v_today date := (now() at time zone 'Africa/Nairobi')::date; v_rows jsonb; v_daily jsonb; v_sum jsonb; v_comm jsonb;
begin
    select g.* into a from byo.sales_agents g join byo.sales_sessions s on s.agent_id = g.id
     where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') and s.expires_at > now() and g.active;
    if not found then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;

    select coalesce(jsonb_agg(x order by (x->>'referred_at') desc), '[]'::jsonb) into v_rows from (
        select jsonb_build_object(
            'tv_id', upper(right(r.device_key, 6)), 'referred_at', r.referred_at, 'first_seen', t.first_seen, 'last_seen', t.last_seen,
            'country', t.state->>'country', 'platform', t.state->>'platform', 'version', t.state->>'version',
            'status', case when exists(select 1 from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held')) then 'paid'
                           else coalesce(nullif(t.state->'billing'->>'state',''), 'trial') end,
            'days', (select coalesce(jsonb_agg(d.day order by d.day), '[]'::jsonb) from byo.device_activity d where d.device_key = r.device_key and d.day >= v_today - 59),
            'active_days', (select count(*) from byo.device_activity d where d.device_key = r.device_key),
            'paid', (select coalesce(jsonb_object_agg(c, s), '{}'::jsonb) from (select p.currency c, sum(p.amount) s from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held') group by p.currency) q)
        ) x
        from byo.referrals r left join byo.tv_devices t on t.device_key = r.device_key where r.agent_id = a.id) z;

    select coalesce(jsonb_agg(jsonb_build_object('day', g.d, 'active', (select count(distinct da.device_key) from byo.device_activity da join byo.referrals r on r.device_key = da.device_key and r.agent_id = a.id where da.day = g.d),
                                                'new', (select count(*) from byo.referrals r where r.agent_id = a.id and (r.referred_at at time zone 'Africa/Nairobi')::date = g.d)) order by g.d), '[]'::jsonb)
      into v_daily from generate_series(0, 29) as n, lateral (select (v_today - 29 + n) as d) g;

    select coalesce(jsonb_object_agg(c, s), '{}'::jsonb) into v_comm from (
        select p.currency c, sum(p.amount) s from byo.pay_received p join byo.referrals r on r.device_key = p.device_key
         where r.agent_id = a.id and p.status in ('matched','held') group by p.currency) q;

    select jsonb_build_object(
        'referrals', count(*),
        'active_today', count(*) filter (where exists(select 1 from byo.device_activity d where d.device_key = r.device_key and d.day = v_today)),
        'active_7d', count(*) filter (where exists(select 1 from byo.device_activity d where d.device_key = r.device_key and d.day > v_today - 7)),
        'active_30d', count(*) filter (where exists(select 1 from byo.device_activity d where d.device_key = r.device_key and d.day > v_today - 30)),
        'paying', count(*) filter (where exists(select 1 from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held'))),
        'new_7d', count(*) filter (where r.referred_at > now() - interval '7 days'))
      into v_sum from byo.referrals r where r.agent_id = a.id;

    return jsonb_build_object('ok', true, 'agent', jsonb_build_object('name', a.name, 'email', a.email, 'code', a.code, 'pct', a.pct),
        'summary', v_sum, 'paid', v_comm, 'daily', v_daily, 'customers', v_rows, 'today', v_today);
end; $$;
revoke all on function public.byo_sales_me(text) from public;
grant execute on function public.byo_sales_me(text) to anon, authenticated;

-- Support console: manage salespeople (through the existing byo_support_admin wrapper; no edge redeploy needed)
do $$
declare d text; o text := E'begin\n    if p_action = \'fleet.list\' then';
        n text := $n$begin
    if p_action = 'fleet.sales_list' then
        return jsonb_build_object('ok', true, 'agents', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'email', g.email, 'code', g.code, 'pct', g.pct, 'active', g.active, 'last_login', g.last_login, 'created_at', g.created_at,
                'referrals', (select count(*) from byo.referrals r where r.agent_id = g.id),
                'active_7d', (select count(distinct da.device_key) from byo.device_activity da join byo.referrals r on r.device_key = da.device_key where r.agent_id = g.id and da.day > (now() at time zone 'Africa/Nairobi')::date - 7),
                'paid', (select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) from (select p.currency cur, sum(p.amount) amt from byo.pay_received p join byo.referrals r on r.device_key = p.device_key where r.agent_id = g.id and p.status in ('matched','held') group by p.currency) q)
            ) order by g.created_at desc) from byo.sales_agents g), '[]'::jsonb));
    end if;
    if p_action = 'fleet.sales_save' then
        declare v_id uuid := nullif(a->>'id','')::uuid; v_name text := left(trim(coalesce(a->>'name','')), 80); v_email text := lower(trim(coalesce(a->>'email','')));
                v_pw text := coalesce(a->>'password',''); v_pct numeric := coalesce(nullif(a->>'pct','')::numeric, 10); v_code text := upper(trim(coalesce(a->>'code','')));
                v_act boolean := coalesce((a->>'active')::boolean, true);
        begin
            if v_pct < 0 or v_pct > 100 then return jsonb_build_object('ok', false, 'error', 'Commission must be between 0 and 100'); end if;
            if v_id is null then
                if v_name = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'Name and a valid email are required'); end if;
                if length(v_pw) < 8 then return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters'); end if;
                if v_code = '' then v_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6)); end if;
                if v_code !~ '^[A-Z0-9]{4,12}$' then return jsonb_build_object('ok', false, 'error', 'Code must be 4 to 12 letters or digits'); end if;
                begin
                    insert into byo.sales_agents(name, email, code, pct, pass_hash, active) values (v_name, v_email, v_code, v_pct, crypt(v_pw, gen_salt('bf')), v_act) returning id into v_id;
                exception when unique_violation then return jsonb_build_object('ok', false, 'error', 'That email or code is already used'); end;
                return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
            end if;
            update byo.sales_agents set name = coalesce(nullif(v_name,''), name), pct = v_pct, active = v_act where id = v_id;
            if length(v_pw) > 0 then
                if length(v_pw) < 8 then return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters'); end if;
                update byo.sales_agents set pass_hash = crypt(v_pw, gen_salt('bf')), fails = 0 where id = v_id;
                delete from byo.sales_sessions where agent_id = v_id;
            end if;
            if not v_act then delete from byo.sales_sessions where agent_id = v_id; end if;
            return jsonb_build_object('ok', true, 'id', v_id);
        end;
    end if;
    if p_action = 'fleet.list' then$n$;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname='byo_support_admin' and pronamespace='public'::regnamespace;
  if position('fleet.sales_list' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, o, ''))) <> length(o) then raise exception 'anchor not unique'; end if;
  d := replace(d, o, n);
  execute d;
end $$;
