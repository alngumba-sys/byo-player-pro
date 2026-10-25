-- ============================================================================
-- BYO Player Pro: more detail in Console > All TVs.
-- fleet.list now also returns, for each TV: what it has paid (totals, count, last
-- payment) and when its free trial ends (reported by TV 3.36.8+).
-- Replaces the console wrapper from 0012 (same actions, plus this). Needs 0012.
-- Safe to run more than once. No admin redeploy needed.
-- ============================================================================

create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- pay-wrapper: payment actions here, everything else goes to byo._support_admin_core
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_agent text := left(coalesce(nullif(trim(a->>'agent'), ''), 'support'), 60);
        c jsonb; v_r jsonb; v_tvs jsonb; v_new jsonb := '{}'::jsonb; k text; pl jsonb; v_plans jsonb; v_num text; v_key text; v_n int;
begin
    if p_action = 'fleet.list' then
        -- the list from 0010, plus what each TV has paid and when its trial ends
        v_r := byo._support_admin_core(p_action, p_args);
        if coalesce((v_r->>'ok')::boolean, false) then
            select coalesce(jsonb_agg(t || jsonb_build_object(
                       'trial_ends', (select d.state->'billing'->>'ends' from byo.tv_devices d where d.device_key = t->>'device_key'),
                       'pay', (select jsonb_build_object('count', count(*),
                                    'KES', coalesce(sum(p.amount) filter (where p.currency = 'KES'), 0),
                                    'ETB', coalesce(sum(p.amount) filter (where p.currency = 'ETB'), 0),
                                    'last', (select jsonb_build_object('amount', q.amount, 'currency', q.currency, 'at', q.received_at, 'method', q.method, 'txn', q.txn_id)
                                               from byo.pay_received q where q.device_key = t->>'device_key' and q.status in ('matched','held') order by q.received_at desc limit 1))
                                 from byo.pay_received p where p.device_key = t->>'device_key' and p.status in ('matched','held')))
                     order by ord), '[]'::jsonb)
              into v_tvs from jsonb_array_elements(v_r->'tvs') with ordinality as x(t, ord);
            v_r := jsonb_set(v_r, '{tvs}', v_tvs);
        end if;
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
            if k not in ('KE','ET') then continue; end if;
            v_num := byo._intl(c->k->>'number', case when k = 'ET' then '251' else '254' end);
            if v_num <> '' and k = 'KE' and v_num !~ '^254[17][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'The Kenya M-Pesa number is not valid.'); end if;
            if v_num <> '' and k = 'ET' and v_num !~ '^251[79][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'The Ethiopia telebirr number is not valid.'); end if;
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
                'method', case when k = 'ET' then 'telebirr' else 'mpesa' end, 'currency', case when k = 'ET' then 'ETB' else 'KES' end,
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
            'today', (select jsonb_build_object('count', count(*), 'KES', coalesce(sum(amount) filter (where currency = 'KES'), 0), 'ETB', coalesce(sum(amount) filter (where currency = 'ETB'), 0))
                        from byo.pay_received where status in ('matched','held') and received_at > date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'));
    end if;

    return byo._support_admin_core(p_action, p_args);
end; $$;
revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;
