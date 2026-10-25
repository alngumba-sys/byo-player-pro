-- ============================================================================
-- BYO Player Pro: Tanzania.
-- Adds a third mobile-money country next to Kenya (M-Pesa) and Ethiopia (telebirr):
-- TZ = 'tzmm' (M-Pesa / Tigo Pesa / Airtel Money paid to our number, matched from the
-- collector phone's SMS), currency TZS, numbers 06x/07x (+255).
--  * byo._cc: 'tzmm' -> 255
--  * byo_pay_start / byo_collector_ingest: accept 'tzmm'
--  * byo_collector_numbers: new optional p_tzmm (the collector phone's TZ number)
--  * byo_support_admin: Plans & prices can be saved for TZ (console shows a Tanzania tab)
-- The collector app's SMS formats for the Tanzanian wallets are added separately.
-- Needs 0012 + 0013. Safe to run more than once.
-- ============================================================================

create or replace function byo._cc(p_method text) returns text language sql immutable as $$
    select case when p_method = 'telebirr' then '251' when p_method = 'tzmm' then '255' else '254' end
$$;

create or replace function public.byo_pay_start(p_device_key text, p_country text, p_plan text, p_phone text)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare c jsonb; pl jsonb; v_cc text := upper(coalesce(p_country,'')); v_method text; v_phone text; v_id uuid; v_n int;
begin
    if coalesce(trim(p_device_key),'') = '' or length(p_device_key) > 120 then return jsonb_build_object('ok', false, 'error', 'bad device'); end if;
    select cfg->v_cc into c from byo.pay_config where id = 1;
    if c is null then return jsonb_build_object('ok', false, 'error', 'Payments are not available in your country yet.'); end if;
    v_method := c->>'method';
    if coalesce(c->>'number','') = '' then return jsonb_build_object('ok', false, 'error', 'Payments are being set up. Please try again soon.'); end if;
    select p into pl from jsonb_array_elements(c->'plans') p where p->>'code' = p_plan and coalesce((p->>'on')::boolean, true) limit 1;
    if pl is null then return jsonb_build_object('ok', false, 'error', 'That plan is not available. Choose another.'); end if;
    v_phone := byo._intl(p_phone, byo._cc(v_method));
    if v_method = 'mpesa' and v_phone !~ '^254[17][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'Enter your Safaricom M-Pesa number, like 0712 345 678.'); end if;
    if v_method = 'telebirr' and v_phone !~ '^251[79][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'Enter your telebirr number, like 0912 345 678.'); end if;
    if v_method = 'tzmm' and v_phone !~ '^255[67][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'Enter your M-Pesa, Tigo Pesa or Airtel Money number, like 0712 345 678.'); end if;
    select count(*) into v_n from byo.pay_requests where device_key = p_device_key and created_at > now() - interval '1 hour';
    if v_n >= 15 then return jsonb_build_object('ok', false, 'error', 'Too many tries. Please wait a few minutes.'); end if;
    -- one open request per TV: the newest choice wins
    update byo.pay_requests set status = 'cancelled' where device_key = p_device_key and status in ('pending','partial');
    insert into byo.pay_requests(device_key, country, method, currency, plan_code, plan_name, days, amount, phone)
    values (p_device_key, v_cc, v_method, c->>'currency', pl->>'code', pl->>'name', (pl->>'days')::int, (pl->>'amount')::numeric, v_phone)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'method', v_method, 'currency', c->>'currency', 'amount', (pl->>'amount')::numeric,
        'plan', pl->>'name', 'days', (pl->>'days')::int, 'number', c->>'number', 'name', c->>'name', 'phone', v_phone,
        'expires_at', now() + interval '2 hours');
end; $$;

-- ---------------------------------------------------------------- collector side
-- p_items: [{ method:'mpesa'|'telebirr'|'tzmm', txn, amount, currency, payer_name, payer_masked, paid_at, raw }]
create or replace function public.byo_collector_ingest(p_key text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare v_hash text; it jsonb; v_out jsonb := '[]'::jsonb; v_method text; v_txn text; v_amt numeric; v_mask text;
        v_pre text; v_suf text; r byo.pay_requests%rowtype; v_pid uuid; v_until timestamptz; v_res text; v_det text; v_by text;
begin
    select collector_key_hash into v_hash from byo.pay_config where id = 1;
    if v_hash is null then return jsonb_build_object('ok', false, 'error', 'Set a collector key in the support console first.'); end if;
    if byo._sha(coalesce(p_key, '')) <> v_hash then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;

    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
        v_method := lower(coalesce(it->>'method', ''));
        v_txn := upper(left(coalesce(it->>'txn', ''), 40));
        begin v_amt := (it->>'amount')::numeric; exception when others then v_amt := null; end;
        v_mask := left(coalesce(it->>'payer_masked', ''), 40);
        if v_method not in ('mpesa','telebirr','tzmm') or v_txn = '' or v_amt is null or v_amt <= 0 then
            v_out := v_out || jsonb_build_object('txn', v_txn, 'result', 'rejected', 'detail', 'missing method, reference or amount');
            continue;
        end if;
        if exists (select 1 from byo.pay_received where method = v_method and txn_id = v_txn) then
            v_out := v_out || (select jsonb_build_object('txn', v_txn, 'result', 'duplicate', 'detail', 'already received: ' || status, 'tv', upper(right(coalesce(device_key,''), 6)))
                               from byo.pay_received where method = v_method and txn_id = v_txn);
            continue;
        end if;

        -- payer digits the SMS shows: first part before the stars, last part after them
        v_pre := byo._intl(split_part(v_mask, '*', 1), byo._cc(v_method));
        v_suf := regexp_replace(regexp_replace(v_mask, '^.*\*', ''), '\D', '', 'g');
        if position('*' in v_mask) = 0 then v_suf := right(v_pre, 3); end if;

        select * into r from byo.pay_requests q
         where q.method = v_method and q.status in ('pending','partial') and q.expires_at > now() - interval '30 minutes'
           and length(v_suf) >= 3 and q.phone like '%' || v_suf
           and (length(v_pre) < 4 or q.phone like v_pre || '%')
         order by (q.amount <= v_amt) desc, case when q.amount <= v_amt then q.amount end desc nulls last, q.created_at desc
         limit 1;

        v_by := case when v_method = 'mpesa' then 'M-Pesa' when v_method = 'tzmm' then 'Mobile money' else 'telebirr' end;
        if r.id is null then
            v_res := 'unmatched'; v_det := 'no TV is waiting for a payment from ' || coalesce(nullif(v_mask,''), 'this number');
        elsif v_amt < r.amount then
            v_res := 'partial'; v_det := 'paid ' || v_amt || ', the ' || r.plan_name || ' plan is ' || r.amount;
            update byo.pay_requests set status = 'partial', paid_amount = coalesce(paid_amount, 0) + v_amt where id = r.id;
        else
            v_until := byo._grant_days(r.device_key, r.days, v_by, r.plan_name, v_txn);
            if v_until is null then
                v_res := 'held'; v_det := 'TV ' || upper(right(r.device_key, 6)) || ' is disabled by support; payment kept';
            else
                v_res := 'matched'; v_det := r.plan_name || ' for TV ' || upper(right(r.device_key, 6)) || ', on until ' || to_char(v_until at time zone 'Africa/Nairobi', 'DD Mon HH24:MI');
            end if;
        end if;

        insert into byo.pay_received(method, txn_id, amount, currency, payer_name, payer_masked, paid_at, status, request_id, device_key, note, raw)
        values (v_method, v_txn, v_amt, coalesce(nullif(it->>'currency',''), case when v_method = 'telebirr' then 'ETB' when v_method = 'tzmm' then 'TZS' else 'KES' end), left(it->>'payer_name', 80), v_mask,
                case when coalesce(it->>'paid_at','') ~ '^\d{4}-' then (it->>'paid_at')::timestamptz else null end,
                v_res, r.id, r.device_key, v_det, left(it->>'raw', 1000))
        returning id into v_pid;
        if v_res in ('matched','held') then
            update byo.pay_requests set status = 'paid', paid_amount = v_amt, paid_at = now(), payment_id = v_pid, granted_until = v_until where id = r.id;
        end if;
        v_out := v_out || jsonb_build_object('txn', v_txn, 'result', v_res, 'detail', v_det, 'tv', case when r.id is null then null else upper(right(r.device_key, 6)) end);
        r := null;
    end loop;
    return jsonb_build_object('ok', true, 'results', v_out);
end; $$;

drop function if exists public.byo_collector_numbers(text, text, text);
create or replace function public.byo_collector_numbers(p_key text, p_telebirr text default null, p_mpesa text default null, p_tzmm text default null)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare v_hash text; v_tb text; v_mp text; v_tz text;
begin
    select collector_key_hash into v_hash from byo.pay_config where id = 1;
    if v_hash is null then return jsonb_build_object('ok', false, 'error', 'Set a collector key in the support console first.'); end if;
    if byo._sha(coalesce(p_key, '')) <> v_hash then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
    v_tb := byo._intl(p_telebirr, '251'); v_mp := byo._intl(p_mpesa, '254'); v_tz := byo._intl(p_tzmm, '255');
    if p_telebirr is not null and v_tb <> '' and v_tb !~ '^251[79][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'bad telebirr number'); end if;
    if p_mpesa is not null and v_mp <> '' and v_mp !~ '^254[17][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'bad M-Pesa number'); end if;
    if p_tzmm is not null and v_tz <> '' and v_tz !~ '^255[67][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'bad Tanzania mobile money number'); end if;
    update byo.pay_config set
        cfg = cfg
            || case when p_telebirr is null then '{}'::jsonb else jsonb_build_object('ET', (cfg->'ET') || jsonb_build_object('number', case when v_tb = '' then '' else '0' || substr(v_tb, 4) end)) end
            || case when p_mpesa is null then '{}'::jsonb else jsonb_build_object('KE', (cfg->'KE') || jsonb_build_object('number', case when v_mp = '' then '' else '0' || substr(v_mp, 4) end)) end
            || case when p_tzmm is null then '{}'::jsonb else jsonb_build_object('TZ', coalesce(cfg->'TZ', '{}'::jsonb) || jsonb_build_object('number', case when v_tz = '' then '' else '0' || substr(v_tz, 4) end)) end,
        updated_at = now(), updated_by = 'collector phone'
     where id = 1;
    return jsonb_build_object('ok', true);
end; $$;

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
                                    'TZS', coalesce(sum(p.amount) filter (where p.currency = 'TZS'), 0),
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
revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;


-- Seed an empty Tanzania entry (the number is filled in from the console or the collector phone).
update byo.pay_config set cfg = cfg || jsonb_build_object('TZ', coalesce(cfg->'TZ',
    jsonb_build_object('method','tzmm','currency','TZS','number','','name','','plans', jsonb_build_array(
        jsonb_build_object('code','m1','name','1 Month','days',30,'amount',10000,'on',true),
        jsonb_build_object('code','m3','name','3 Months','days',90,'amount',27000,'on',true),
        jsonb_build_object('code','m12','name','12 Months','days',365,'amount',96000,'on',true)))))
 where id = 1;

revoke all on function public.byo_collector_numbers(text, text, text, text) from public;
grant execute on function public.byo_collector_numbers(text, text, text, text) to anon, authenticated;
