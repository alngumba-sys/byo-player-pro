-- ============================================================================
-- 0031: salesperson tools and accounts.
--
--   1. Customer names/phone numbers (byo.referrals.label), set by the salesperson, searchable in the portal.
--   2. Commission payouts: you record what you paid each salesperson per month; the portal shows earned, paid out, still owed.
--   3. Audit trail (byo.sales_audit): every activation, reactivation (including failed tries) is logged with who, which
--      customer and which devices. Reactivations are limited per customer (default 3 in 30 days) and wrong-code guessing
--      is slowed down (10 failed tries in 10 minutes pauses that salesperson).
--   4. Funnel numbers per salesperson: installs, activated, paid.
--   5. Export data for CSV files (customers, commissions, payouts), used by the console and the portal.
--
-- Needs 0019 to 0030. Nothing is renamed, so it is safe to run more than once. Run in the Supabase SQL Editor for BYO Tv.
-- ============================================================================

alter table byo.referrals add column if not exists label text;

create table if not exists byo.sales_payouts (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null references byo.sales_agents(id) on delete cascade,
    period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    amount numeric not null check (amount > 0 and amount < 100000000),
    method text, ref text, note text,
    paid_at timestamptz not null default now(),
    created_by text, voided_at timestamptz, voided_by text
);
create index if not exists sales_payouts_agent on byo.sales_payouts (agent_id, period);
alter table byo.sales_payouts enable row level security;

create table if not exists byo.sales_audit (
    id bigserial primary key,
    at timestamptz not null default now(),
    agent_id uuid references byo.sales_agents(id) on delete set null,
    action text not null,                       -- activate | reactivate
    referral_id uuid,
    device_old text, device_new text,
    ok boolean not null default true,
    detail text
);
create index if not exists sales_audit_at on byo.sales_audit (at desc);
create index if not exists sales_audit_ref on byo.sales_audit (referral_id, action, at desc);
alter table byo.sales_audit enable row level security;

insert into byo.app_config(key, value) values ('reactivation_limit', '3'::jsonb) on conflict (key) do nothing;

-- ---------------------------------------------------------------- activation: the existing logic, now logged
create or replace function byo._sales_activate_core(p_token text, p_rid uuid)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; r byo.referrals; c byo.conn_pool; v_days int; v_until timestamptz; v_cur jsonb; v_left int;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    select * into r from byo.referrals where id = p_rid and agent_id = a.id for update;     -- only your own customers
    if not found then return jsonb_build_object('ok', false, 'error', 'That customer was not found.'); end if;
    if exists (select 1 from byo.provisions where device_key = r.device_key) then return jsonb_build_object('ok', true, 'already', true); end if;
    select flags->'access' into v_cur from byo.device_flags where device_key = r.device_key;
    if v_cur is not null and v_cur->>'state' = 'blocked' then return jsonb_build_object('ok', false, 'error', 'This device was switched off by BYO support. Contact support.'); end if;

    perform byo._pool_refresh();
    -- fill the most used connection that still has room first, so fresh ones stay untouched
    select * into c from byo.conn_pool where status = 'available'
     order by (select count(*) from byo.provisions pv where pv.pool_id = byo.conn_pool.id) desc, created_at, id limit 1 for update skip locked;
    if not found then
        insert into byo.admin_alerts(kind, message) values ('pool_empty', 'The connection pool is empty. A salesperson tried to activate a customer. Add more connections.') on conflict do nothing;
        return jsonb_build_object('ok', false, 'pool_empty', true, 'error', 'No connections are available right now. The admin has been notified. Please try again later.');
    end if;

    v_days := coalesce((select (value)::text::int from byo.app_config where key = 'activation_trial_days'), 7);
    update byo.conn_pool set assigned_device_key = coalesce(assigned_device_key, r.device_key), assigned_agent_id = coalesce(assigned_agent_id, a.id), assigned_at = coalesce(assigned_at, now()) where id = c.id;
    insert into byo.provisions(device_key, referral_id, agent_id, pool_id, trial_days) values (r.device_key, r.id, a.id, c.id, v_days);
    perform byo._pool_refresh();

    v_until := now() + make_interval(days => v_days);
    if v_cur is not null and v_cur->>'state' = 'active' and (v_cur->>'until')::timestamptz > v_until then v_until := (v_cur->>'until')::timestamptz; end if;
    insert into byo.device_flags(device_key, flags, updated_at)
    values (r.device_key, jsonb_build_object('access', jsonb_build_object('state','active','until', v_until,'at', now(),'by','sales:'||a.name,'paid', coalesce((v_cur->>'paid')::boolean,false),'plan','trial','ref','activation')), now())
    on conflict (device_key) do update set flags = byo.device_flags.flags || jsonb_build_object('access', jsonb_build_object('state','active','until', v_until,'at', now(),'by','sales:'||a.name,'paid', coalesce((v_cur->>'paid')::boolean,false),'plan','trial','ref','activation')), updated_at = now();

    select count(*) into v_left from byo.conn_pool where status = 'available';
    if v_left = 0 then insert into byo.admin_alerts(kind, message) values ('pool_empty', 'The connection pool is now full. Add more connections or raise the customers per connection.') on conflict do nothing;
    elsif v_left <= 3 then insert into byo.admin_alerts(kind, message) values ('pool_low', 'Only a few connections have room left. Add more soon.') on conflict do nothing; end if;
    return jsonb_build_object('ok', true, 'trial_days', v_days, 'ends_at', v_until);
end $$;
revoke all on function byo._sales_activate_core(text, uuid) from public, anon, authenticated;

create or replace function public.byo_sales_activate(p_token text, p_rid uuid)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; r jsonb; v_dev text; v_ok boolean;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    r := byo._sales_activate_core(p_token, p_rid);
    select device_key into v_dev from byo.referrals where id = p_rid and agent_id = a.id;
    if v_dev is not null and not coalesce((r->>'already')::boolean, false) then
        v_ok := coalesce((r->>'ok')::boolean, false);
        insert into byo.sales_audit(agent_id, action, referral_id, device_new, ok, detail)
        values (a.id, 'activate', p_rid, v_dev, v_ok, case when v_ok then 'trial ' || coalesce(r->>'trial_days', '') || ' days' else left(coalesce(r->>'error', ''), 200) end);
    end if;
    return r;
end $$;
revoke all on function public.byo_sales_activate(text, uuid) from public;
grant execute on function public.byo_sales_activate(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------- reactivation: the existing logic, limited and logged
create or replace function byo._sales_reactivate_core(p_token text, p_rid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; r byo.referrals; pv byo.provisions; s byo.support_sessions;
        v_code text := regexp_replace(coalesce(p_code,''), '[^0-9]', '', 'g');
        v_old text; v_new text; v_oldacc jsonb; v_newacc jsonb; v_until timestamptz; v_dup byo.referrals;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    if v_code !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'error', 'Type the 4 digit code shown on the customer''s screen.'); end if;

    select * into r from byo.referrals where id = p_rid and agent_id = a.id for update;          -- only your own customers
    if not found then return jsonb_build_object('ok', false, 'error', 'That customer was not found.'); end if;
    v_old := r.device_key;

    select * into pv from byo.provisions where device_key = v_old for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'This customer has not been activated yet. Use Activate instead.'); end if;

    select flags->'access' into v_oldacc from byo.device_flags where device_key = v_old;
    if v_oldacc is null or v_oldacc->>'state' = 'blocked' then
        return jsonb_build_object('ok', false, 'error', 'This device was switched off by BYO support. Contact support.');
    end if;
    if v_oldacc->>'state' <> 'active' or (v_oldacc->>'until')::timestamptz <= now() then
        return jsonb_build_object('ok', false, 'expired', true, 'error', 'Their activated period has ended, so it cannot be reactivated here.');
    end if;
    v_until := (v_oldacc->>'until')::timestamptz;

    select * into s from byo.support_sessions where code = v_code and status = 'waiting' and expires_at > now() order by created_at desc limit 1 for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'That code was not found or has expired. Ask the customer for the code now on their screen.');
    end if;
    -- the code is registered under the app's activation key; the app also tells us its real device id in the same call
    v_new := nullif(case when s.device_key like 'act-%' then s.device_state->>'device_id' else s.device_key end, '');
    if v_new is null then
        return jsonb_build_object('ok', false, 'error', 'That screen is running an older BYO Player that cannot be reactivated by code. Ask the customer to update the app and show the code again.');
    end if;
    if v_new = v_old then return jsonb_build_object('ok', false, 'error', 'That is the same device. It is already activated.'); end if;
    if exists (select 1 from byo.provisions where device_key = v_new) then
        return jsonb_build_object('ok', false, 'error', 'That device is already activated for another customer.');
    end if;

    -- the new install may already carry a referral (the customer typed or opened the code again). Same salesperson and
    -- nothing paid yet: fold it into this customer. Anything else is not ours to take.
    select * into v_dup from byo.referrals where device_key = v_new for update;
    if found then
        if v_dup.agent_id <> a.id then return jsonb_build_object('ok', false, 'error', 'That device already belongs to another salesperson.'); end if;
        if exists (select 1 from byo.pay_received where device_key = v_new) then
            return jsonb_build_object('ok', false, 'error', 'That device already has payments. Contact support.');
        end if;
        delete from byo.referrals where id = v_dup.id;
    end if;

    -- 1. the customer (same referral row) now lives on the new device
    update byo.referrals set device_key = v_new where id = r.id;
    -- 2. their payments follow, so the commission already earned stays with the customer
    update byo.pay_received set device_key = v_new where device_key = v_old;
    update byo.pay_requests set device_key = v_new where device_key = v_old;
    -- 3. the same connection follows; the new app collects it at its next check-in
    update byo.conn_pool set assigned_device_key = v_new where assigned_device_key = v_old;
    update byo.provisions set device_key = v_new, fetched_at = null, acked_at = null, attempts = 0, last_error = null,
                              activated_at = now(), moved_from = v_old, moved_at = now()
     where device_key = v_old;
    -- 4. the remaining time moves over (never more than they had, never a fresh trial)
    select flags->'access' into v_newacc from byo.device_flags where device_key = v_new;
    if v_newacc is not null and v_newacc->>'state' = 'active' and (v_newacc->>'until')::timestamptz > v_until then v_until := (v_newacc->>'until')::timestamptz; end if;
    insert into byo.device_flags(device_key, flags, updated_at)
    values (v_new, jsonb_build_object('access', v_oldacc || jsonb_build_object('state', 'active', 'until', v_until, 'at', now(), 'by', 'sales:' || a.name, 'ref', 'reactivation')), now())
    on conflict (device_key) do update
        set flags = byo.device_flags.flags || jsonb_build_object('access', v_oldacc || jsonb_build_object('state', 'active', 'until', v_until, 'at', now(), 'by', 'sales:' || a.name, 'ref', 'reactivation')),
            updated_at = now();
    -- 5. the code is used up
    update byo.support_sessions set status = 'ended', ended_at = now(), ended_by = 'sales:' || a.name where id = s.id;

    return jsonb_build_object('ok', true, 'ends_at', v_until, 'tv_id', upper(right(v_new, 6)));
end $$;
revoke all on function byo._sales_reactivate_core(text, uuid, text) from public, anon, authenticated;

create or replace function public.byo_sales_reactivate(p_token text, p_rid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; rf byo.referrals; r jsonb; v_lim int; v_n int; v_fail int; v_ok boolean; v_new text;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    select * into rf from byo.referrals where id = p_rid and agent_id = a.id;
    if not found then return byo._sales_reactivate_core(p_token, p_rid, p_code); end if;

    v_lim := coalesce((select (value)::text::int from byo.app_config where key = 'reactivation_limit'), 3);
    select count(*) into v_n from byo.sales_audit where referral_id = p_rid and action = 'reactivate' and ok and at > now() - interval '30 days';
    if v_n >= v_lim then
        insert into byo.sales_audit(agent_id, action, referral_id, device_old, ok, detail) values (a.id, 'reactivate', p_rid, rf.device_key, false, 'blocked: limit of ' || v_lim || ' in 30 days reached');
        return jsonb_build_object('ok', false, 'limit', true, 'error', 'This customer has already been moved to a new device ' || v_n || ' times in 30 days. Contact BYO support.');
    end if;
    select count(*) into v_fail from byo.sales_audit where agent_id = a.id and action = 'reactivate' and not ok and detail not like 'blocked:%' and at > now() - interval '10 minutes';
    if v_fail >= 10 then
        insert into byo.sales_audit(agent_id, action, referral_id, device_old, ok, detail) values (a.id, 'reactivate', p_rid, rf.device_key, false, 'blocked: too many wrong tries');
        return jsonb_build_object('ok', false, 'error', 'Too many wrong codes. Please wait 10 minutes and try again.');
    end if;

    r := byo._sales_reactivate_core(p_token, p_rid, p_code);
    v_ok := coalesce((r->>'ok')::boolean, false);
    select device_key into v_new from byo.referrals where id = p_rid;
    insert into byo.sales_audit(agent_id, action, referral_id, device_old, device_new, ok, detail)
    values (a.id, 'reactivate', p_rid, rf.device_key, case when v_ok then v_new end, v_ok, case when v_ok then 'moved to a new device' else left(coalesce(r->>'error', ''), 200) end);
    return r;
end $$;
revoke all on function public.byo_sales_reactivate(text, uuid, text) from public;
grant execute on function public.byo_sales_reactivate(text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------- earned / paid out / owed, per month
create or replace function byo._payout_view(p_agent uuid)
returns jsonb language plpgsql stable security definer set search_path = byo, public, extensions as $$
declare v_rate numeric; v_first date; v_cur date; m date; m0 timestamptz; m1 timestamptz; v_e numeric; v_p numeric; v_months jsonb := '[]'::jsonb;
        v_total_e numeric; v_total_p numeric; v_items jsonb;
begin
    select rate_kes into v_rate from byo.sales_agents where id = p_agent;
    v_cur := date_trunc('month', now() at time zone 'Africa/Nairobi')::date;
    select least(coalesce(min(date_trunc('month', r.referred_at at time zone 'Africa/Nairobi')::date), v_cur),
                 coalesce((select min(to_date(po.period || '-01', 'YYYY-MM-DD')) from byo.sales_payouts po where po.agent_id = p_agent and po.voided_at is null), v_cur))
      into v_first from byo.referrals r where r.agent_id = p_agent;
    m := v_first;
    while m <= v_cur loop
        m0 := m::timestamp at time zone 'Africa/Nairobi'; m1 := (m + interval '1 month')::timestamp at time zone 'Africa/Nairobi';
        v_e := round(coalesce((select sum(byo._pay_months(r.device_key, m0, m1)) from byo.referrals r where r.agent_id = p_agent), 0) * coalesce(v_rate, 100));
        v_p := coalesce((select sum(po.amount) from byo.sales_payouts po where po.agent_id = p_agent and po.period = to_char(m, 'YYYY-MM') and po.voided_at is null), 0);
        if v_e > 0 or v_p > 0 or m = v_cur then
            v_months := jsonb_build_array(jsonb_build_object('period', to_char(m, 'YYYY-MM'), 'label', to_char(m, 'FMMonth YYYY'), 'earned', v_e, 'paid', v_p, 'owed', v_e - v_p)) || v_months;
        end if;
        m := (m + interval '1 month')::date;
    end loop;
    v_total_e := round(coalesce((select sum(byo._pay_months(r.device_key)) from byo.referrals r where r.agent_id = p_agent), 0) * coalesce(v_rate, 100));
    v_total_p := coalesce((select sum(po.amount) from byo.sales_payouts po where po.agent_id = p_agent and po.voided_at is null), 0);
    select coalesce(jsonb_agg(jsonb_build_object('id', po.id, 'period', po.period, 'amount', po.amount, 'method', po.method, 'ref', po.ref, 'note', po.note, 'paid_at', po.paid_at,
                                                'by', po.created_by, 'voided', po.voided_at is not null) order by po.paid_at desc), '[]'::jsonb)
      into v_items from (select * from byo.sales_payouts where agent_id = p_agent order by paid_at desc limit 200) po;
    return jsonb_build_object('rate', v_rate, 'earned', v_total_e, 'paid_out', v_total_p, 'owed', v_total_e - v_total_p, 'months', v_months, 'items', v_items);
end $$;
revoke all on function byo._payout_view(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the portal: names, funnel, payouts, reactivation counts
create or replace function public.byo_sales_more(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; v_lim int;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    v_lim := coalesce((select (value)::text::int from byo.app_config where key = 'reactivation_limit'), 3);
    return jsonb_build_object('ok', true,
        'labels', (select coalesce(jsonb_object_agg(r.id::text, r.label), '{}'::jsonb) from byo.referrals r where r.agent_id = a.id and coalesce(r.label, '') <> ''),
        'react', (select coalesce(jsonb_object_agg(q.rid, q.n), '{}'::jsonb) from (select referral_id::text rid, count(*) n from byo.sales_audit
                    where action = 'reactivate' and ok and at > now() - interval '30 days' and referral_id in (select id from byo.referrals where agent_id = a.id) group by 1) q),
        'react_limit', v_lim,
        'funnel', (select jsonb_build_object('installs', count(*),
                        'activated', count(*) filter (where exists (select 1 from byo.provisions pv where pv.device_key = r.device_key)),
                        'paid', count(*) filter (where exists (select 1 from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held'))))
                     from byo.referrals r where r.agent_id = a.id),
        'payouts', byo._payout_view(a.id));
end $$;
revoke all on function public.byo_sales_more(text) from public;
grant execute on function public.byo_sales_more(text) to anon, authenticated;

create or replace function public.byo_sales_label(p_token text, p_rid uuid, p_label text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; v text := nullif(left(trim(coalesce(p_label, '')), 60), '');
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    update byo.referrals set label = v where id = p_rid and agent_id = a.id;
    if not found then return jsonb_build_object('ok', false, 'error', 'That customer was not found.'); end if;
    return jsonb_build_object('ok', true, 'label', v);
end $$;
revoke all on function public.byo_sales_label(text, uuid, text) from public;
grant execute on function public.byo_sales_label(text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------- console: new top layer (replaces the one from 0030; still calls byo._admin_top)
create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_cap int; v_lim int; v_r jsonb; v_n int; v_id uuid; v_amt numeric; v_per text; v_by text := left(coalesce(nullif(trim(a->>'agent'), ''), 'support'), 60);
        g record; c jsonb; v_rows jsonb := '[]'::jsonb; v_view jsonb; mo jsonb;
begin
    if p_action = 'fleet.pool_list' then
        perform byo._pool_refresh();
        return jsonb_build_object('ok', true, 'cap', byo._pool_cap(),
            'counts', (select jsonb_build_object('available', count(*) filter (where status='available'), 'assigned', count(*) filter (where status='assigned'), 'disabled', count(*) filter (where status='disabled')) from byo.conn_pool),
            'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'message', message, 'created_at', created_at) order by created_at desc), '[]'::jsonb) from byo.admin_alerts where resolved_at is null),
            'trial_days', coalesce((select (value)::text::int from byo.app_config where key = 'activation_trial_days'), 7),
            'items', (select coalesce(jsonb_agg(x order by (x->>'sort'), (x->>'created_at') desc), '[]'::jsonb) from (
                select jsonb_build_object('id', p.id, 'mode', p.mode, 'name', p.name, 'server', p.server, 'url', case when p.url is null then null else regexp_replace(p.url, '(password|pass|pwd)=[^&]*', '\1=***', 'gi') end,
                    'username', p.username, 'status', p.status, 'created_at', p.created_at, 'assigned_at', p.assigned_at,
                    'trial_days', coalesce((select (value)::text::int from byo.app_config where key = 'activation_trial_days'), 7),
                    'users', (select count(*) from byo.provisions pv where pv.pool_id = p.id), 'cap', byo._pool_cap(),
                    'tvs', (select coalesce(jsonb_agg(upper(right(pv.device_key, 6)) order by pv.activated_at), '[]'::jsonb) from (select * from byo.provisions where pool_id = p.id order by activated_at limit 8) pv),
                    'assigned_tv', case when p.assigned_device_key is null then null else upper(right(p.assigned_device_key, 6)) end,
                    'agent', g2.name, 'sort', case p.status when 'available' then '1' when 'assigned' then '2' else '3' end) x
                  from byo.conn_pool p left join byo.sales_agents g2 on g2.id = p.assigned_agent_id
                 order by p.created_at desc limit 600) t));
    end if;

    if p_action = 'fleet.pool_delete' then
        if exists (select 1 from byo.provisions where pool_id = nullif(a->>'id','')::uuid) then return jsonb_build_object('ok', false, 'error', 'Customers are using this connection, so it cannot be deleted.'); end if;
        delete from byo.conn_pool where id = nullif(a->>'id','')::uuid and status in ('available','disabled');
        get diagnostics v_n = row_count;
        return jsonb_build_object('ok', v_n = 1, 'error', case when v_n = 1 then null else 'That connection cannot be deleted' end);
    end if;

    if p_action = 'fleet.activation_set' and (a ? 'max_users' or a ? 'reactivation_limit') then
        if a ? 'max_users' then
            v_cap := nullif(a->>'max_users','')::int;
            if v_cap is null or v_cap < 1 or v_cap > 100 then return jsonb_build_object('ok', false, 'error', 'Customers per connection must be between 1 and 100'); end if;
            insert into byo.app_config(key, value) values ('connection_max_users', to_jsonb(v_cap)) on conflict (key) do update set value = excluded.value;
            perform byo._pool_refresh();
            select count(*) into v_n from byo.conn_pool where status = 'available';
            update byo.admin_alerts set resolved_at = now() where resolved_at is null and ((kind = 'pool_empty' and v_n > 0) or (kind = 'pool_low' and v_n > 3));
        end if;
        if a ? 'reactivation_limit' then
            v_lim := nullif(a->>'reactivation_limit','')::int;
            if v_lim is null or v_lim < 0 or v_lim > 50 then return jsonb_build_object('ok', false, 'error', 'Reactivations per customer must be between 0 and 50'); end if;
            insert into byo.app_config(key, value) values ('reactivation_limit', to_jsonb(v_lim)) on conflict (key) do update set value = excluded.value;
        end if;
        if a ? 'trial_days' then return byo._admin_top(p_action, a - 'max_users' - 'reactivation_limit'); end if;
        return jsonb_build_object('ok', true);
    end if;

    -- salespeople list: the funnel (installs, activated, paid), what has been paid out and what is owed
    if p_action = 'fleet.sales_list' then
        v_r := byo._admin_top(p_action, p_args);
        if coalesce((v_r->>'ok')::boolean, false) then
            v_r := jsonb_set(v_r, '{agents}', coalesce((
                select jsonb_agg(e || jsonb_build_object('installs', f.n, 'activated', f.a, 'paid_customers', f.p, 'paid_out', po.t, 'owed', coalesce((e->>'commission')::numeric, 0) - po.t) order by o.ord)
                  from jsonb_array_elements(v_r->'agents') with ordinality o(e, ord)
                  cross join lateral (select count(*) n,
                         count(*) filter (where exists (select 1 from byo.provisions pv where pv.device_key = r.device_key)) a,
                         count(*) filter (where exists (select 1 from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held'))) p
                       from byo.referrals r where r.agent_id = (o.e->>'id')::uuid) f
                  cross join lateral (select coalesce(sum(amount), 0) t from byo.sales_payouts where agent_id = (o.e->>'id')::uuid and voided_at is null) po), '[]'::jsonb));
            v_r := v_r || jsonb_build_object('settings', jsonb_build_object('reactivation_limit', coalesce((select (value)::text::int from byo.app_config where key = 'reactivation_limit'), 3)));
        end if;
        return v_r;
    end if;

    if p_action = 'fleet.payout_summary' then
        v_id := nullif(a->>'id','')::uuid;
        if not exists (select 1 from byo.sales_agents where id = v_id) then return jsonb_build_object('ok', false, 'error', 'Salesperson not found'); end if;
        return jsonb_build_object('ok', true) || byo._payout_view(v_id);
    end if;

    if p_action = 'fleet.payout_add' then
        v_id := nullif(a->>'id','')::uuid; v_amt := nullif(a->>'amount','')::numeric; v_per := trim(coalesce(a->>'period',''));
        if not exists (select 1 from byo.sales_agents where id = v_id) then return jsonb_build_object('ok', false, 'error', 'Salesperson not found'); end if;
        if v_amt is null or v_amt <= 0 or v_amt >= 100000000 then return jsonb_build_object('ok', false, 'error', 'Enter the amount paid, for example 1500'); end if;
        if v_per !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then return jsonb_build_object('ok', false, 'error', 'Pick the month this payment is for'); end if;
        insert into byo.sales_payouts(agent_id, period, amount, method, ref, note, created_by)
        values (v_id, v_per, v_amt, left(nullif(trim(coalesce(a->>'method','')), ''), 40), left(nullif(trim(coalesce(a->>'ref','')), ''), 80), left(nullif(trim(coalesce(a->>'note','')), ''), 200), v_by);
        return jsonb_build_object('ok', true) || byo._payout_view(v_id);
    end if;

    if p_action = 'fleet.payout_void' then
        update byo.sales_payouts set voided_at = now(), voided_by = v_by where id = nullif(a->>'payout','')::uuid and voided_at is null returning agent_id into v_id;
        if v_id is null then return jsonb_build_object('ok', false, 'error', 'That payout was not found'); end if;
        return jsonb_build_object('ok', true) || byo._payout_view(v_id);
    end if;

    if p_action = 'fleet.audit_list' then
        return jsonb_build_object('ok', true, 'items', (select coalesce(jsonb_agg(x order by (x->>'at') desc), '[]'::jsonb) from (
            select jsonb_build_object('id', au.id, 'at', au.at, 'agent', sg.name, 'action', au.action, 'ok', au.ok, 'detail', au.detail,
                       'label', rf.label, 'tv', upper(right(coalesce(au.device_new, au.device_old, rf.device_key), 6)), 'old_tv', upper(right(au.device_old, 6)),
                       'new_tv', upper(right(au.device_new, 6))) x
              from byo.sales_audit au left join byo.sales_agents sg on sg.id = au.agent_id left join byo.referrals rf on rf.id = au.referral_id
             where (nullif(a->>'id','') is null or au.agent_id = (a->>'id')::uuid)
               and (coalesce(a->>'kind','') = '' or a->>'kind' = 'all' or (a->>'kind' = 'failed' and not au.ok) or au.action = a->>'kind')
             order by au.at desc limit 300) q));
    end if;

    -- data for the CSV files (the console builds the file)
    if p_action = 'fleet.export' then
        if coalesce(a->>'kind','') = 'customers' then
            for g in select id, name from byo.sales_agents order by name loop
                for c in select * from jsonb_array_elements(byo._sales_customers(g.id)) loop
                    v_rows := v_rows || jsonb_build_array(jsonb_build_object('salesperson', g.name, 'name', (select label from byo.referrals where id = (c->>'rid')::uuid), 'device_id', c->>'tv_id',
                        'platform', c->>'platform', 'status', c->>'status', 'installed', c->>'referred_at', 'activated', c->>'activated_at', 'access_ends', c->>'ends_at',
                        'paid_months', c->>'months', 'commission_kes', c->>'commission'));
                end loop;
            end loop;
            return jsonb_build_object('ok', true, 'rows', v_rows);
        elsif a->>'kind' = 'commissions' then
            for g in select id, name from byo.sales_agents order by name loop
                v_view := byo._payout_view(g.id);
                for mo in select * from jsonb_array_elements(v_view->'months') loop
                    v_rows := v_rows || jsonb_build_array(jsonb_build_object('salesperson', g.name, 'month', mo->>'period', 'earned_kes', mo->>'earned', 'paid_out_kes', mo->>'paid', 'owed_kes', mo->>'owed'));
                end loop;
            end loop;
            return jsonb_build_object('ok', true, 'rows', v_rows);
        elsif a->>'kind' = 'payouts' then
            select coalesce(jsonb_agg(jsonb_build_object('salesperson', sg.name, 'month', po.period, 'amount_kes', po.amount, 'method', po.method, 'reference', po.ref, 'note', po.note, 'paid_at', po.paid_at, 'recorded_by', po.created_by, 'voided', po.voided_at is not null) order by po.paid_at), '[]'::jsonb)
              into v_rows from byo.sales_payouts po join byo.sales_agents sg on sg.id = po.agent_id;
            return jsonb_build_object('ok', true, 'rows', v_rows);
        end if;
        return jsonb_build_object('ok', false, 'error', 'Unknown export');
    end if;

    return byo._admin_top(p_action, p_args);
end $$;
revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;

notify pgrst, 'reload schema';
