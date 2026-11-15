-- ============================================================================
-- 0024: commission is a flat KSh amount per paid month per customer (not a percentage),
--       and the console gets the data for its redesigned Sales team / Connection pool screens.
--
--  * byo.sales_agents.rate_kes          KSh per paid month (default 100)
--  * byo._pay_months(device, from, to)  paid months for one customer: the days they paid for / 30
--                                       (Monthly = 1, Quarterly = 3, Weekly = 0.23 ...; a payment with no plan counts as 1)
--  * byo._sales_customers(agent)        one salesperson's customers with months and commission (used by both screens)
--  * public.byo_sales_dash              the salesperson's dashboard now reports commission in KSh
--  * public.byo_support_admin  (top)    console: sales_list, sales_customers, pool_list, pool_reveal, sales_save with a KSh rate
--
-- Run it AFTER 0022 (and 0023). Safe to run more than once. It replaces the top console layer only; the layers
-- below it (0022) are not touched and nothing is renamed.
-- ============================================================================
alter table byo.sales_agents add column if not exists rate_kes numeric not null default 100;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_agents_rate_kes_check') then
    alter table byo.sales_agents add constraint sales_agents_rate_kes_check check (rate_kes >= 0 and rate_kes <= 100000);
  end if;
end $$;

create or replace function byo._pay_months(p_device text, p_from timestamptz default null, p_to timestamptz default null)
returns numeric language sql stable security definer set search_path = byo, public as $$
    select coalesce(sum(coalesce(q.days, 30)) / 30.0, 0)
      from byo.pay_received p left join byo.pay_requests q on q.id = p.request_id
     where p.device_key = p_device and p.status in ('matched','held')
       and (p_from is null or coalesce(p.paid_at, p.received_at) >= p_from)
       and (p_to is null or coalesce(p.paid_at, p.received_at) < p_to);
$$;
revoke all on function byo._pay_months(text, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function byo._sales_customers(p_agent uuid)
returns jsonb language plpgsql stable security definer set search_path = byo, public, extensions as $$
declare v_rate numeric; v_rows jsonb;
begin
    select rate_kes into v_rate from byo.sales_agents where id = p_agent;
    select coalesce(jsonb_agg(x order by (x->>'referred_at') desc), '[]'::jsonb) into v_rows from (
        select jsonb_build_object(
            'rid', r.id, 'tv_id', upper(right(r.device_key, 6)), 'referred_at', r.referred_at, 'last_seen', t.last_seen,
            'platform', t.state->>'platform', 'country', t.state->>'country',
            'activated', pv.device_key is not null, 'activated_at', pv.activated_at, 'delivered', pv.acked_at is not null,
            'status', case when s.st = 'blocked' then 'expired'
                           when s.st = 'active' and s.u > now() then
                                case when pa.any_paid or s.paid then 'paid' when s.u <= now() + interval '48 hours' then 'expiring' else 'trial' end
                           when s.u is not null then 'expired' else 'pending' end,
            'ends_at', s.u,
            'seconds_left', case when s.st = 'active' and s.u > now() then floor(extract(epoch from (s.u - now()))) end,
            'active_days', (select count(*) from byo.device_activity d where d.device_key = r.device_key),
            'active_7d', exists(select 1 from byo.device_activity d where d.device_key = r.device_key and d.day > (now() at time zone 'Africa/Nairobi')::date - 7),
            'months', round(m.mo, 2), 'commission', round(m.mo * coalesce(v_rate, 100)),
            'paid', (select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) from (select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held') group by 1) q),
            'payments', (select coalesce(jsonb_agg(jsonb_build_object('at', coalesce(p.paid_at, p.received_at), 'amount', p.amount, 'currency', p.currency, 'method', p.method, 'ref', p.txn_id,
                                  'plan', q2.plan_name, 'days', q2.days, 'until', q2.granted_until,
                                  'from', case when q2.granted_until is not null and q2.days is not null then q2.granted_until - make_interval(days => q2.days) end)
                                  order by coalesce(p.paid_at, p.received_at) desc), '[]'::jsonb)
                           from byo.pay_received p left join byo.pay_requests q2 on q2.id = p.request_id
                          where p.device_key = r.device_key and p.status in ('matched','held'))
        ) x
        from byo.referrals r
        left join byo.tv_devices t on t.device_key = r.device_key
        left join byo.provisions pv on pv.device_key = r.device_key
        left join lateral (select flags->'access' acc from byo.device_flags where device_key = r.device_key) f on true
        cross join lateral (select (f.acc->>'until')::timestamptz u, f.acc->>'state' st, coalesce((f.acc->>'paid')::boolean, false) paid) s
        cross join lateral (select exists(select 1 from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held')) any_paid) pa
        cross join lateral (select byo._pay_months(r.device_key) mo) m
        where r.agent_id = p_agent) z;
    return v_rows;
end $$;
revoke all on function byo._sales_customers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the salesperson's dashboard
create or replace function public.byo_sales_dash(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents;
        v_m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
        v_msales jsonb; v_asales jsonb; v_new_m int; v_new_all int; v_mm numeric; v_am numeric;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;

    select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) into v_msales from (
        select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p join byo.referrals r on r.device_key = p.device_key
         where r.agent_id = a.id and p.status in ('matched','held') and coalesce(p.paid_at, p.received_at) >= v_m0 group by 1) q;
    select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) into v_asales from (
        select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p join byo.referrals r on r.device_key = p.device_key
         where r.agent_id = a.id and p.status in ('matched','held') group by 1) q;
    select count(*) filter (where referred_at >= v_m0), count(*) into v_new_m, v_new_all from byo.referrals where agent_id = a.id;
    select coalesce(sum(byo._pay_months(r.device_key, v_m0)), 0), coalesce(sum(byo._pay_months(r.device_key)), 0) into v_mm, v_am from byo.referrals r where r.agent_id = a.id;

    return jsonb_build_object('ok', true,
        'agent', jsonb_build_object('name', a.name, 'email', a.email, 'code', a.code, 'code_set', a.code_set, 'rate', a.rate_kes),
        'month', jsonb_build_object('label', to_char(now() at time zone 'Africa/Nairobi', 'FMMonth YYYY'), 'sales', v_msales, 'new_users', v_new_m,
                                    'months', round(v_mm, 2), 'commission', round(v_mm * a.rate_kes)),
        'all_time', jsonb_build_object('sales', v_asales, 'users', v_new_all, 'months', round(v_am, 2), 'commission', round(v_am * a.rate_kes)),
        'customers', byo._sales_customers(a.id), 'now', now());
end $$;
revoke all on function public.byo_sales_dash(text) from public;
grant execute on function public.byo_sales_dash(text) to anon, authenticated;

-- ---------------------------------------------------------------- console (top layer)
create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- top layer: salespeople (phone, KSh rate, commission), pool list/reveal; everything else goes to byo._admin_ref
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_by text := left(coalesce(nullif(trim(a->>'agent'), ''), 'support'), 60);
        v_digits text; v_key text; v_name text; v_email text; v_code text; v_rate numeric; v_act boolean; v_id uuid; v_last4 text; r jsonb; c byo.conn_pool; v_out jsonb;
begin
    if p_action = 'fleet.sales_list' then
        select jsonb_build_object('ok', true,
                 'agents', coalesce(jsonb_agg(e order by (e->>'created_at') desc), '[]'::jsonb),
                 'totals', jsonb_build_object(
                    'agents', count(*) filter (where (e->>'active')::boolean),
                    'referrals', coalesce(sum((e->>'referrals')::int), 0),
                    'active_7d', coalesce(sum((e->>'active_7d')::int), 0),
                    'trials', coalesce(sum((e->>'trials')::int), 0),
                    'paying', coalesce(sum((e->>'paying')::int), 0),
                    'months', coalesce(sum((e->>'months')::numeric), 0),
                    'commission', coalesce(sum((e->>'commission')::numeric), 0)))
          into v_out
          from (
            select jsonb_build_object('id', g.id, 'name', g.name, 'email', g.email, 'phone', g.phone, 'code', g.code, 'code_set', coalesce(g.code_set, false),
                    'rate', g.rate_kes, 'active', g.active, 'must_change', coalesce(g.must_change, false), 'last_login', g.last_login, 'created_at', g.created_at,
                    'referrals', s.n, 'active_7d', s.a7, 'trials', s.tr, 'paying', s.pay, 'months', round(s.mo, 2), 'commission', round(s.mo * g.rate_kes),
                    'paid', (select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) from (select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p join byo.referrals rr on rr.device_key = p.device_key where rr.agent_id = g.id and p.status in ('matched','held') group by 1) q)) e
              from byo.sales_agents g
              cross join lateral (
                select count(*) n,
                       count(*) filter (where exists(select 1 from byo.device_activity da where da.device_key = rf.device_key and da.day > (now() at time zone 'Africa/Nairobi')::date - 7)) a7,
                       count(*) filter (where exists(select 1 from byo.pay_received p where p.device_key = rf.device_key and p.status in ('matched','held'))) pay,
                       count(*) filter (where not exists(select 1 from byo.pay_received p where p.device_key = rf.device_key and p.status in ('matched','held'))
                                          and exists(select 1 from byo.device_flags f where f.device_key = rf.device_key and f.flags->'access'->>'state' = 'active' and (f.flags->'access'->>'until')::timestamptz > now())) tr,
                       coalesce(sum(byo._pay_months(rf.device_key)), 0) mo
                  from byo.referrals rf where rf.agent_id = g.id) s
          ) z;
        return v_out;
    end if;

    if p_action = 'fleet.sales_customers' then
        return jsonb_build_object('ok', true, 'customers', byo._sales_customers(nullif(a->>'id','')::uuid));
    end if;

    if p_action = 'fleet.pool_list' then
        return jsonb_build_object('ok', true,
            'counts', (select jsonb_build_object('available', count(*) filter (where status='available'), 'assigned', count(*) filter (where status='assigned'), 'disabled', count(*) filter (where status='disabled')) from byo.conn_pool),
            'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'message', message, 'created_at', created_at) order by created_at desc), '[]'::jsonb) from byo.admin_alerts where resolved_at is null),
            'trial_days', coalesce((select (value)::text::int from byo.app_config where key = 'activation_trial_days'), 7),
            'items', (select coalesce(jsonb_agg(x order by (x->>'sort'), (x->>'created_at') desc), '[]'::jsonb) from (
                select jsonb_build_object('id', p.id, 'mode', p.mode, 'name', p.name, 'server', p.server, 'url', case when p.url is null then null else regexp_replace(p.url, '(password|pass|pwd)=[^&]*', '\1=***', 'gi') end,
                    'username', p.username, 'status', p.status, 'created_at', p.created_at, 'assigned_at', p.assigned_at,
                    'trial_days', coalesce(pv.trial_days, (select (value)::text::int from byo.app_config where key = 'activation_trial_days'), 7),
                    'assigned_tv', case when p.assigned_device_key is null then null else upper(right(p.assigned_device_key, 6)) end,
                    'agent', g.name, 'sort', case p.status when 'available' then '1' when 'assigned' then '2' else '3' end) x
                  from byo.conn_pool p left join byo.sales_agents g on g.id = p.assigned_agent_id left join byo.provisions pv on pv.pool_id = p.id
                 order by p.created_at desc limit 600) t));
    end if;

    -- the console shows passwords masked; the real one is fetched only when the eye or Copy is pressed (and logged)
    if p_action = 'fleet.pool_reveal' then
        select * into c from byo.conn_pool where id = nullif(a->>'id','')::uuid;
        if not found then return jsonb_build_object('ok', false, 'error', 'That connection no longer exists.'); end if;
        insert into byo.support_audit(device_key, actor, action, detail) values (null, v_by, 'pool.reveal', jsonb_build_object('id', c.id));
        return jsonb_build_object('ok', true, 'mode', c.mode, 'password', c.password, 'url', c.url);
    end if;

    -- create with a phone number: first password = last 4 digits, must be changed at first sign-in
    if p_action = 'fleet.sales_save' and nullif(a->>'id','') is null and nullif(trim(coalesce(a->>'phone','')), '') is not null then
        v_digits := regexp_replace(a->>'phone', '\D', '', 'g');
        if length(v_digits) < 9 or length(v_digits) > 15 then return jsonb_build_object('ok', false, 'error', 'Enter the full phone number, for example 0712345678 or +254712345678'); end if;
        v_key := right(v_digits, 9); v_last4 := right(v_digits, 4);
        v_name := left(trim(coalesce(a->>'name','')), 80); v_email := nullif(lower(trim(coalesce(a->>'email',''))), '');
        v_code := upper(trim(coalesce(a->>'code',''))); v_rate := coalesce(nullif(a->>'rate','')::numeric, 100); v_act := coalesce((a->>'active')::boolean, true);
        if v_name = '' then return jsonb_build_object('ok', false, 'error', 'Name is required'); end if;
        if v_rate < 0 or v_rate > 100000 then return jsonb_build_object('ok', false, 'error', 'Commission must be between 0 and 100000 KSh per paid month'); end if;
        if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'That email does not look right (or leave it empty)'); end if;
        if v_code <> '' and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$' then return jsonb_build_object('ok', false, 'error', 'Code must be 4 to 20 letters or numbers'); end if;
        begin
            insert into byo.sales_agents(name, email, phone, phone_key, code, rate_kes, pass_hash, active, must_change)
            values (v_name, v_email, a->>'phone', v_key, nullif(v_code,''), v_rate, crypt(v_last4, gen_salt('bf')), v_act, true) returning id into v_id;
        exception when unique_violation then return jsonb_build_object('ok', false, 'error', 'That phone number, email or code is already used'); end;
        return jsonb_build_object('ok', true, 'id', v_id, 'code', nullif(v_code,''), 'first_password', 'the last 4 digits of the phone number');
    end if;

    -- reset to the default (last 4 digits of the phone) and force a new PIN again
    if p_action = 'fleet.sales_save' and nullif(a->>'id','') is not null and coalesce((a->>'reset_default')::boolean, false) then
        v_id := (a->>'id')::uuid;
        select right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 4) into v_last4 from byo.sales_agents where id = v_id;
        if v_last4 is null or length(v_last4) < 4 then return jsonb_build_object('ok', false, 'error', 'This salesperson has no phone number on file. Set a password instead.'); end if;
        update byo.sales_agents set pass_hash = crypt(v_last4, gen_salt('bf')), must_change = true, fails = 0 where id = v_id;
        delete from byo.sales_sessions where agent_id = v_id;
        return jsonb_build_object('ok', true, 'id', v_id);
    end if;

    -- any other salesperson save (edit, switch on/off, create with email): the lower layer does it, then the KSh rate is applied
    if p_action = 'fleet.sales_save' then
        v_rate := nullif(a->>'rate','')::numeric;
        if v_rate is not null and (v_rate < 0 or v_rate > 100000) then return jsonb_build_object('ok', false, 'error', 'Commission must be between 0 and 100000 KSh per paid month'); end if;
        r := byo._admin_ref(p_action, a - 'rate');
        if v_rate is not null and coalesce((r->>'ok')::boolean, false) and nullif(r->>'id','') is not null then
            update byo.sales_agents set rate_kes = v_rate where id = (r->>'id')::uuid;
        end if;
        return r;
    end if;

    return byo._admin_ref(p_action, p_args);
end $$;

revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;
notify pgrst, 'reload schema';
