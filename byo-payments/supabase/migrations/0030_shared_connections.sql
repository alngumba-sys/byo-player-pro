-- ============================================================================
-- 0030: one connection can serve several customers.
--
--   * New setting: customers per connection (default 5, change it in the console, Connection Pool tab).
--   * Activate gives the next customer a connection that still has room, filling one connection before starting the next.
--     A connection shows "Assigned" only when it is full; below that it stays "Available".
--   * The app collects its connection by its own provision (not by being the first customer on it).
--   * The console pool list shows "n of N customers" per connection; a connection in use cannot be deleted.
--
-- Builds on 0019 to 0029. Nothing is renamed, so it is safe to run more than once. Run in the Supabase SQL Editor for BYO Tv.
-- ============================================================================

insert into byo.app_config(key, value) values ('connection_max_users', '5'::jsonb) on conflict (key) do nothing;

create or replace function byo._pool_cap() returns int language sql stable security definer set search_path = byo, public as $$
    select greatest(1, least(100, coalesce((select (value)::text::int from byo.app_config where key = 'connection_max_users'), 5)))
$$;

-- Assigned = full, Available = has room. Disabled is left alone.
create or replace function byo._pool_refresh() returns void language sql security definer set search_path = byo, public as $$
    update byo.conn_pool p set status = u.want
      from (select q.id, case when q.n >= byo._pool_cap() then 'assigned' else 'available' end as want
              from (select c.id, (select count(*) from byo.provisions pv where pv.pool_id = c.id) n from byo.conn_pool c where c.status in ('available','assigned')) q) u
     where p.id = u.id and p.status <> u.want;
$$;
revoke all on function byo._pool_cap() from public, anon, authenticated;
revoke all on function byo._pool_refresh() from public, anon, authenticated;

-- ---------------------------------------------------------------- Activate: a connection with room
create or replace function public.byo_sales_activate(p_token text, p_rid uuid)
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
revoke all on function public.byo_sales_activate(text,uuid) from public;
grant execute on function public.byo_sales_activate(text,uuid) to anon, authenticated;

-- ---------------------------------------------------------------- the app collects its own connection
create or replace function public.byo_provision_fetch(p_device_key text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare pv byo.provisions; c byo.conn_pool;
begin
    select * into pv from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days';
    if not found then return jsonb_build_object('ok', true, 'none', true); end if;
    select * into c from byo.conn_pool where id = pv.pool_id;
    if not found then return jsonb_build_object('ok', true, 'none', true); end if;
    update byo.provisions set fetched_at = now(), attempts = attempts + 1 where device_key = p_device_key;
    return jsonb_build_object('ok', true, 'conn', jsonb_build_object('mode', c.mode, 'name', coalesce(nullif(c.name,''), 'BYO Player'), 'server', coalesce(c.server,''), 'url', coalesce(c.url,''),
                              'user', coalesce(c.username,''), 'pass', coalesce(c.password,''), 'epg', coalesce(c.epg,'')));
end $$;
revoke all on function public.byo_provision_fetch(text) from public;
grant execute on function public.byo_provision_fetch(text) to anon, authenticated;

-- ---------------------------------------------------------------- console: the layer below is a copy of the current top layer
create or replace function byo._admin_top(p_action text, p_args jsonb default '{}'::jsonb)
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
revoke all on function byo._admin_top(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- console: new top layer
create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_cap int; v_r jsonb; v_n int;
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
                    'agent', g.name, 'sort', case p.status when 'available' then '1' when 'assigned' then '2' else '3' end) x
                  from byo.conn_pool p left join byo.sales_agents g on g.id = p.assigned_agent_id
                 order by p.created_at desc limit 600) t));
    end if;

    if p_action = 'fleet.pool_delete' then       -- only a connection nobody is using
        if exists (select 1 from byo.provisions where pool_id = nullif(a->>'id','')::uuid) then return jsonb_build_object('ok', false, 'error', 'Customers are using this connection, so it cannot be deleted.'); end if;
        delete from byo.conn_pool where id = nullif(a->>'id','')::uuid and status in ('available','disabled');
        get diagnostics v_n = row_count;
        return jsonb_build_object('ok', v_n = 1, 'error', case when v_n = 1 then null else 'That connection cannot be deleted' end);
    end if;

    if p_action = 'fleet.activation_set' and a ? 'max_users' then
        v_cap := nullif(a->>'max_users','')::int;
        if v_cap is null or v_cap < 1 or v_cap > 100 then return jsonb_build_object('ok', false, 'error', 'Customers per connection must be between 1 and 100'); end if;
        insert into byo.app_config(key, value) values ('connection_max_users', to_jsonb(v_cap)) on conflict (key) do update set value = excluded.value;
        perform byo._pool_refresh();
        select count(*) into v_n from byo.conn_pool where status = 'available';
        update byo.admin_alerts set resolved_at = now() where resolved_at is null and ((kind = 'pool_empty' and v_n > 0) or (kind = 'pool_low' and v_n > 3));
        if a ? 'trial_days' then return byo._admin_top(p_action, a - 'max_users'); end if;
        return jsonb_build_object('ok', true, 'max_users', v_cap);
    end if;

    return byo._admin_top(p_action, p_args);
end $$;
revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;

select byo._pool_refresh();
notify pgrst, 'reload schema';
