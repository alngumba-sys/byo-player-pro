-- ============================================================================
-- Console action chain: ONE file that owns it, so it can never loop again.
--
-- Why this exists: earlier files added layers to the console function (public.byo_support_admin) by renaming it, and
-- running one of them a second time made the layers call each other forever ("stack depth limit exceeded"), which also
-- deleted the payments layer. This file rebuilds all layers under fixed names. Nothing is renamed, so it is safe to
-- run any number of times, and 0019, 0020 and 0021 no longer touch the console function.
--
--   public.byo_support_admin  (top)   salespeople with a phone number, reset to last 4 digits       (was 0021)
--      -> byo._admin_ref              referral gate on / off                                         (was 0020)
--      -> byo._admin_pool             connection pool, sales list, salespeople without a preset code (was 0019)
--      -> byo._admin_pay              payments, All TVs + installs summary, salespeople save         (0015 + 0017 + 0018)
--      -> byo._support_admin_core     remote support and the rest                                    (0010, unchanged)
--
-- Needs 0012 and everything after it, 0018, and 0019 + 0021 (tables and columns). Run it AFTER 0021.
-- ============================================================================

-- payments / fleet layer
create or replace function byo._admin_pay(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- pay-wrapper: payment actions here, everything else goes to byo._support_admin_core
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_agent text := left(coalesce(nullif(trim(a->>'agent'), ''), 'support'), 60);
        c jsonb; v_r jsonb; v_tvs jsonb; v_new jsonb := '{}'::jsonb; k text; pl jsonb; v_plans jsonb; v_num text; v_key text; v_n int;
begin
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
        if p_action = 'fleet.list' then
        -- the list from 0010, plus what each TV has paid and when its trial ends
        v_r := byo._support_admin_core(p_action, p_args);
        if coalesce((v_r->>'ok')::boolean, false) then
            select coalesce(jsonb_agg(t || jsonb_build_object(
                       'trial_ends', (select d.state->'billing'->>'ends' from byo.tv_devices d where d.device_key = t->>'device_key'),
                       'pay', (select jsonb_build_object('count', count(*),
                                    'KES', coalesce(sum(p.amount) filter (where p.currency = 'KES'), 0),
                                    'ETB', coalesce(sum(p.amount) filter (where p.currency = 'ETB'), 0),
                                    'TZS', coalesce(sum(p.amount) filter (where p.currency = 'TZS'), 0),
                                    'last', (select jsonb_build_object('amount', q.amount, 'currency', q.currency, 'at', q.received_at, 'method', q.method, 'txn', q.txn_id)
                                               from byo.pay_received q where q.device_key = t->>'device_key' and q.status in ('matched','held') order by q.received_at desc limit 1))
                                 from byo.pay_received p where p.device_key = t->>'device_key' and p.status in ('matched','held')))
                     order by ord), '[]'::jsonb)
              into v_tvs from jsonb_array_elements(v_r->'tvs') with ordinality as x(t, ord);
            v_r := jsonb_set(v_r, '{tvs}', v_tvs);
        end if;
        v_r := v_r || jsonb_build_object('installs', (select jsonb_build_object(
                'total', count(*),
                'active_24h', count(*) filter (where d.last_seen > now() - interval '24 hours'),
                'active_7d', count(*) filter (where d.last_seen > now() - interval '7 days'),
                'active_30d', count(*) filter (where d.last_seen > now() - interval '30 days'),
                'new_7d', count(*) filter (where d.first_seen > now() - interval '7 days'),
                'paying', (select count(distinct p.device_key) from byo.pay_received p where p.status in ('matched','held')))
            from byo.tv_devices d));
        return v_r;
    end if;

    if p_action = 'fleet.pay_config' then
        return (select jsonb_build_object('ok', true, 'cfg', cfg, 'collector_key_set', collector_key_hash is not null,
                       'updated_at', updated_at, 'updated_by', updated_by) from byo.pay_config where id = 1);
    end if;

    if p_action = 'fleet.pay_config_set' then
        c := a->'cfg';
        if c is null or jsonb_typeof(c) <> 'object' then return jsonb_build_object('ok', false, 'error', 'cfg required'); end if;
        for k in select jsonb_object_keys(c) loop
            if k not in ('KE','ET','TZ') then continue; end if;
            v_num := byo._intl(c->k->>'number', case when k = 'ET' then '251' when k = 'TZ' then '255' else '254' end);
            if v_num <> '' and k = 'KE' and v_num !~ '^254[17][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'The Kenya M-Pesa number is not valid.'); end if;
            if v_num <> '' and k = 'ET' and v_num !~ '^251[79][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'The Ethiopia telebirr number is not valid.'); end if;
            if v_num <> '' and k = 'TZ' and v_num !~ '^255[67][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'The Tanzania mobile money number is not valid.'); end if;
            v_plans := '[]'::jsonb; v_n := 0;
            for pl in select * from jsonb_array_elements(coalesce(c->k->'plans', '[]'::jsonb)) loop
                v_n := v_n + 1;
                if v_n > 8 then exit; end if;
                if coalesce(pl->>'code','') !~ '^[a-z0-9_]{1,20}$' then return jsonb_build_object('ok', false, 'error', 'bad plan code'); end if;
                if length(trim(coalesce(pl->>'name',''))) not between 1 and 24 then return jsonb_build_object('ok', false, 'error', 'Each plan needs a name (up to 24 letters).'); end if;
                if coalesce((pl->>'days')::int, 0) not between 1 and 3650 then return jsonb_build_object('ok', false, 'error', 'Days must be between 1 and 3650.'); end if;
                if coalesce((pl->>'amount')::numeric, 0) <= 0 or (pl->>'amount')::numeric > 1000000 then return jsonb_build_object('ok', false, 'error', 'Each price must be more than 0.'); end if;
                v_plans := v_plans || jsonb_build_object('code', pl->>'code', 'name', trim(pl->>'name'), 'days', (pl->>'days')::int,
                    'amount', round((pl->>'amount')::numeric, 2), 'on', coalesce((pl->>'on')::boolean, true));
            end loop;
            v_new := v_new || jsonb_build_object(k, jsonb_build_object(
                'method', case when k = 'ET' then 'telebirr' when k = 'TZ' then 'tzmm' else 'mpesa' end, 'currency', case when k = 'ET' then 'ETB' when k = 'TZ' then 'TZS' else 'KES' end,
                'number', case when v_num = '' then '' else '0' || substr(v_num, 4) end,
                'name', left(trim(coalesce(c->k->>'name','')), 40), 'plans', v_plans));
        end loop;
        update byo.pay_config set cfg = cfg || v_new, updated_at = now(), updated_by = v_agent where id = 1;
        insert into byo.support_audit(device_key, actor, action, detail) values (null, v_agent, 'pay.config', v_new);
        return (select jsonb_build_object('ok', true, 'cfg', cfg, 'collector_key_set', collector_key_hash is not null, 'updated_at', updated_at, 'updated_by', updated_by)
                  from byo.pay_config where id = 1);
    end if;

    if p_action = 'fleet.pay_key_new' then
        v_key := 'byoc_' || encode(gen_random_bytes(16), 'hex');
        update byo.pay_config set collector_key_hash = byo._sha(v_key), updated_at = now(), updated_by = v_agent where id = 1;
        insert into byo.support_audit(device_key, actor, action) values (null, v_agent, 'pay.key_new');
        return jsonb_build_object('ok', true, 'key', v_key);
    end if;

    if p_action = 'fleet.payments' then
        return jsonb_build_object('ok', true,
            'received', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'method', method, 'txn', txn_id, 'amount', amount, 'currency', currency,
                    'payer_name', payer_name, 'payer', payer_masked, 'at', received_at, 'status', status, 'note', note,
                    'tv_id', case when device_key is null then null else upper(right(device_key, 6)) end) order by received_at desc)
                from (select * from byo.pay_received order by received_at desc limit least(coalesce((a->>'limit')::int, 50), 200)) x), '[]'::jsonb),
            'waiting', coalesce((select jsonb_agg(jsonb_build_object('tv_id', upper(right(device_key, 6)), 'method', method, 'plan', plan_name,
                    'amount', amount, 'currency', currency, 'payer', '0' || substr(phone, 4, 3) || '***' || right(phone, 3), 'at', created_at, 'status', status) order by created_at desc)
                from (select * from byo.pay_requests where status in ('pending','partial') and expires_at > now() order by created_at desc limit 50) y), '[]'::jsonb),
            'today', (select jsonb_build_object('count', count(*), 'KES', coalesce(sum(amount) filter (where currency = 'KES'), 0), 'ETB', coalesce(sum(amount) filter (where currency = 'ETB'), 0), 'TZS', coalesce(sum(amount) filter (where currency = 'TZS'), 0))
                        from byo.pay_received where status in ('matched','held') and received_at > date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'));
    end if;

    return byo._support_admin_core(p_action, p_args);
end; $$;
revoke all on function byo._admin_pay(text, jsonb) from public, anon, authenticated;

-- connection pool layer
create or replace function byo._admin_pool(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- pool-wrapper: connection pool + salesperson actions here, everything else goes to byo._support_admin_pre_pool
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_by text := left(coalesce(nullif(trim(a->>'agent'), ''), 'support'), 60);
        it jsonb; v_mode text; v_server text; v_url text; v_user text; v_pass text; v_name text; v_epg text; v_add int := 0; v_skip int := 0; v_bad int := 0; v_id uuid; v_st text; v_n int;
        v_nm text; v_em text; v_pw text; v_pct numeric; v_act boolean;
begin
    if p_action = 'fleet.pool_list' then
        return jsonb_build_object('ok', true,
            'counts', (select jsonb_build_object('available', count(*) filter (where status='available'), 'assigned', count(*) filter (where status='assigned'), 'disabled', count(*) filter (where status='disabled')) from byo.conn_pool),
            'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'message', message, 'created_at', created_at) order by created_at desc), '[]'::jsonb) from byo.admin_alerts where resolved_at is null),
            'trial_days', coalesce((select (value)::text::int from byo.app_config where key = 'activation_trial_days'), 7),
            'items', (select coalesce(jsonb_agg(x order by (x->>'sort'), (x->>'created_at') desc), '[]'::jsonb) from (
                select jsonb_build_object('id', p.id, 'mode', p.mode, 'name', p.name, 'server', p.server, 'url', case when p.url is null then null else regexp_replace(p.url, '(password|pass|pwd)=[^&]*', '\1=***', 'gi') end,
                    'username', p.username, 'status', p.status, 'created_at', p.created_at, 'assigned_at', p.assigned_at,
                    'assigned_tv', case when p.assigned_device_key is null then null else upper(right(p.assigned_device_key, 6)) end,
                    'agent', g.name, 'sort', case p.status when 'available' then '1' when 'assigned' then '2' else '3' end) x
                  from byo.conn_pool p left join byo.sales_agents g on g.id = p.assigned_agent_id order by p.created_at desc limit 400) t));
    end if;

    if p_action = 'fleet.pool_add' then
        if jsonb_typeof(a->'items') <> 'array' or jsonb_array_length(a->'items') = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to add'); end if;
        if jsonb_array_length(a->'items') > 2000 then return jsonb_build_object('ok', false, 'error', 'Add at most 2000 at a time'); end if;
        for it in select * from jsonb_array_elements(a->'items') loop
            v_mode := lower(coalesce(it->>'mode','xtream')); v_server := nullif(trim(coalesce(it->>'server','')), ''); v_url := nullif(trim(coalesce(it->>'url','')), '');
            v_user := nullif(trim(coalesce(it->>'username','')), ''); v_pass := nullif(coalesce(it->>'password',''), ''); v_name := left(trim(coalesce(it->>'name','')), 80); v_epg := nullif(trim(coalesce(it->>'epg','')), '');
            if v_mode not in ('xtream','m3u') or length(coalesce(v_server,'')||coalesce(v_url,'')||coalesce(v_user,'')||coalesce(v_pass,'')) > 1500
               or (v_mode = 'xtream' and (v_server is null or v_user is null or v_pass is null or v_server !~* '^https?://'))
               or (v_mode = 'm3u' and (v_url is null or v_url !~* '^https?://')) then v_bad := v_bad + 1; continue; end if;
            insert into byo.conn_pool(mode, name, server, url, username, password, epg, created_by) values (v_mode, v_name, case when v_mode='xtream' then rtrim(v_server,'/') end, case when v_mode='m3u' then v_url end,
                   case when v_mode='xtream' then v_user end, case when v_mode='xtream' then v_pass end, v_epg, v_by) on conflict do nothing;
            get diagnostics v_n = row_count; if v_n = 1 then v_add := v_add + 1; else v_skip := v_skip + 1; end if;
        end loop;
        if v_add > 0 then
            select count(*) into v_n from byo.conn_pool where status = 'available';
            update byo.admin_alerts set resolved_at = now() where resolved_at is null and ((kind = 'pool_empty' and v_n > 0) or (kind = 'pool_low' and v_n > 3));
        end if;
        return jsonb_build_object('ok', true, 'added', v_add, 'duplicates', v_skip, 'invalid', v_bad);
    end if;

    if p_action = 'fleet.pool_set' then          -- only Available <-> Disabled; an Assigned connection stays with its customer
        v_id := nullif(a->>'id','')::uuid; v_st := a->>'status';
        if v_st not in ('available','disabled') then return jsonb_build_object('ok', false, 'error', 'Bad status'); end if;
        update byo.conn_pool set status = v_st where id = v_id and status in ('available','disabled');
        get diagnostics v_n = row_count;
        return jsonb_build_object('ok', v_n = 1, 'error', case when v_n = 1 then null else 'Assigned connections cannot be changed here' end);
    end if;

    if p_action = 'fleet.pool_delete' then       -- unused ones only; assigned rows are kept as the record
        delete from byo.conn_pool where id = nullif(a->>'id','')::uuid and status in ('available','disabled');
        get diagnostics v_n = row_count;
        return jsonb_build_object('ok', v_n = 1, 'error', case when v_n = 1 then null else 'Assigned connections cannot be deleted' end);
    end if;

    if p_action = 'fleet.alerts_ack' then
        update byo.admin_alerts set resolved_at = now() where resolved_at is null;
        return jsonb_build_object('ok', true);
    end if;

    if p_action = 'fleet.activation_set' then
        v_n := least(greatest(coalesce(nullif(a->>'trial_days','')::int, 7), 1), 90);
        insert into byo.app_config(key, value) values ('activation_trial_days', to_jsonb(v_n)) on conflict (key) do update set value = excluded.value, updated_at = now();
        return jsonb_build_object('ok', true, 'trial_days', v_n);
    end if;

    if p_action = 'fleet.sales_list' then
        return jsonb_build_object('ok', true, 'agents', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'email', g.email, 'code', g.code, 'code_set', g.code_set, 'pct', g.pct, 'active', g.active,
                'last_login', g.last_login, 'created_at', g.created_at,
                'referrals', (select count(*) from byo.referrals r where r.agent_id = g.id),
                'activated', (select count(*) from byo.provisions pv where pv.agent_id = g.id),
                'active_7d', (select count(distinct da.device_key) from byo.device_activity da join byo.referrals r on r.device_key = da.device_key where r.agent_id = g.id and da.day > (now() at time zone 'Africa/Nairobi')::date - 7),
                'paid', (select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) from (select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p join byo.referrals r on r.device_key = p.device_key where r.agent_id = g.id and p.status in ('matched','held') group by 1) q)
            ) order by g.created_at desc) from byo.sales_agents g), '[]'::jsonb));
    end if;

    -- a new salesperson WITHOUT a preset code picks their own, once, from the sales page
    if p_action = 'fleet.sales_save' and nullif(a->>'id','') is null and trim(coalesce(a->>'code','')) = '' then
        v_nm := left(trim(coalesce(a->>'name','')), 80); v_em := lower(trim(coalesce(a->>'email',''))); v_pw := coalesce(a->>'password','');
        v_pct := coalesce(nullif(a->>'pct','')::numeric, 10); v_act := coalesce((a->>'active')::boolean, true);
        if v_pct < 0 or v_pct > 100 then return jsonb_build_object('ok', false, 'error', 'Commission must be between 0 and 100'); end if;
        if v_nm = '' or v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'Name and a valid email are required'); end if;
        if length(v_pw) < 8 then return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters'); end if;
        begin
            insert into byo.sales_agents(name, email, code, pct, pass_hash, active) values (v_nm, v_em, null, v_pct, crypt(v_pw, gen_salt('bf')), v_act) returning id into v_id;
        exception when unique_violation then return jsonb_build_object('ok', false, 'error', 'That email is already used'); end;
        return jsonb_build_object('ok', true, 'id', v_id, 'code', null);
    end if;

    return byo._admin_pay(p_action, p_args);
end $$;

revoke all on function byo._admin_pool(text, jsonb) from public, anon, authenticated;

-- referral gate layer
create or replace function byo._admin_ref(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- ref-wrapper: referral gate switch here, everything else goes to byo._support_admin_pre_ref
begin
    if p_action = 'fleet.referral_gate_get' then
        return jsonb_build_object('ok', true, 'on', exists(select 1 from byo.app_config where key = 'referral_required_from'),
                                  'from', (select value #>> '{}' from byo.app_config where key = 'referral_required_from'));
    end if;
    if p_action = 'fleet.referral_gate_set' then
        if coalesce((p_args->>'on')::boolean, false) then
            insert into byo.app_config(key, value) values ('referral_required_from', to_jsonb(now()::text))
            on conflict (key) do update set value = to_jsonb(now()::text), updated_at = now();     -- only installs from now on
        else delete from byo.app_config where key = 'referral_required_from'; end if;
        return jsonb_build_object('ok', true);
    end if;
    return byo._admin_pool(p_action, p_args);
end $$;

revoke all on function byo._admin_ref(text, jsonb) from public, anon, authenticated;

-- top layer (what the console calls)
create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- phone-wrapper: salespeople with a phone number; everything else goes to byo._support_admin_pre_phone
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_digits text; v_key text; v_name text; v_email text; v_code text; v_pct numeric; v_act boolean; v_id uuid; v_last4 text; r jsonb;
begin
    if p_action = 'fleet.sales_list' then
        r := byo._admin_ref(p_action, p_args);
        if coalesce((r->>'ok')::boolean, false) then
            r := jsonb_set(r, '{agents}', coalesce((select jsonb_agg(e || jsonb_build_object('phone', g.phone, 'must_change', coalesce(g.must_change, false)) order by (e->>'created_at') desc)
                              from jsonb_array_elements(r->'agents') e left join byo.sales_agents g on g.id = (e->>'id')::uuid), '[]'::jsonb));
        end if;
        return r;
    end if;

    -- create with a phone number: first password = last 4 digits, must be changed at first sign-in
    if p_action = 'fleet.sales_save' and nullif(a->>'id','') is null and nullif(trim(coalesce(a->>'phone','')), '') is not null then
        v_digits := regexp_replace(a->>'phone', '\D', '', 'g');
        if length(v_digits) < 9 or length(v_digits) > 15 then return jsonb_build_object('ok', false, 'error', 'Enter the full phone number, for example 0712345678 or +254712345678'); end if;
        v_key := right(v_digits, 9); v_last4 := right(v_digits, 4);
        v_name := left(trim(coalesce(a->>'name','')), 80); v_email := nullif(lower(trim(coalesce(a->>'email',''))), '');
        v_code := upper(trim(coalesce(a->>'code',''))); v_pct := coalesce(nullif(a->>'pct','')::numeric, 10); v_act := coalesce((a->>'active')::boolean, true);
        if v_name = '' then return jsonb_build_object('ok', false, 'error', 'Name is required'); end if;
        if v_pct < 0 or v_pct > 100 then return jsonb_build_object('ok', false, 'error', 'Commission must be between 0 and 100'); end if;
        if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'That email does not look right (or leave it empty)'); end if;
        if v_code <> '' and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$' then return jsonb_build_object('ok', false, 'error', 'Code must be 4 to 20 letters or numbers'); end if;
        begin
            insert into byo.sales_agents(name, email, phone, phone_key, code, pct, pass_hash, active, must_change)
            values (v_name, v_email, a->>'phone', v_key, nullif(v_code,''), v_pct, crypt(v_last4, gen_salt('bf')), v_act, true) returning id into v_id;
        exception when unique_violation then return jsonb_build_object('ok', false, 'error', 'That phone number, email or code is already used'); end;
        return jsonb_build_object('ok', true, 'id', v_id, 'code', nullif(v_code,''), 'first_password', 'the last 4 digits of the phone number');
    end if;

    -- reset to the default (last 4 digits of the phone) and force a new password again
    if p_action = 'fleet.sales_save' and nullif(a->>'id','') is not null and coalesce((a->>'reset_default')::boolean, false) then
        v_id := (a->>'id')::uuid;
        select right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 4) into v_last4 from byo.sales_agents where id = v_id;
        if v_last4 is null or length(v_last4) < 4 then return jsonb_build_object('ok', false, 'error', 'This salesperson has no phone number on file. Set a password instead.'); end if;
        update byo.sales_agents set pass_hash = crypt(v_last4, gen_salt('bf')), must_change = true, fails = 0 where id = v_id;
        delete from byo.sales_sessions where agent_id = v_id;
        return jsonb_build_object('ok', true, 'id', v_id);
    end if;

    return byo._admin_ref(p_action, p_args);
end $$;

revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;

-- the old chained names are gone for good
drop function if exists byo._support_admin_pre_pool(text, jsonb);
drop function if exists byo._support_admin_pre_ref(text, jsonb);
drop function if exists byo._support_admin_pre_phone(text, jsonb);
notify pgrst, 'reload schema';
