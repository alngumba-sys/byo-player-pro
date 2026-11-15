-- ============================================================================
-- ONE-OFF CLEAN START: removes every customer (referral) and their test activations.
-- Run it ONCE in the Supabase SQL Editor for BYO Tv. It cannot be undone.
--
--   * Salespeople, their referral codes, the connection pool and all settings are KEPT.
--   * Each customer is removed together with their activation, trial time and waiting activation codes.
--   * Connections they were using go back to the pool (their customer count drops to 0).
--   * SAFETY: if any of these customers has a payment on record, nothing is deleted and the script stops
--     with a message, so real money records are never lost.
-- ============================================================================
do $$
declare v_keys text[]; v_pay int; v_ref int; v_prov int;
begin
    select coalesce(array_agg(device_key), '{}') into v_keys from byo.referrals;
    select count(*) into v_pay from (
        select 1 from byo.pay_received where device_key = any(v_keys)
        union all select 1 from byo.pay_requests where device_key = any(v_keys)) q;
    if v_pay > 0 then
        raise exception 'Stopped: % payment record(s) exist for these customers. Nothing was deleted. Ask Claude before removing them.', v_pay;
    end if;

    update byo.support_sessions set status = 'ended', ended_at = now(), ended_by = 'reset' where device_key = any(v_keys) and status in ('waiting','connected');
    update byo.conn_pool set assigned_device_key = null, assigned_agent_id = null, assigned_at = null where assigned_device_key = any(v_keys);
    delete from byo.provisions where device_key = any(v_keys);
    get diagnostics v_prov = row_count;
    update byo.device_flags set flags = flags - 'access', updated_at = now() where device_key = any(v_keys);
    delete from byo.referrals where device_key = any(v_keys);
    get diagnostics v_ref = row_count;

    if to_regprocedure('byo._pool_refresh()') is not null then perform byo._pool_refresh(); end if;
    update byo.conn_pool set status = 'available' where status = 'assigned' and not exists (select 1 from byo.provisions pv where pv.pool_id = byo.conn_pool.id);
    raise notice 'Done: % customer(s) and % activation(s) removed.', v_ref, v_prov;
end $$;

select (select count(*) from byo.referrals) as customers_left,
       (select count(*) from byo.provisions) as activations_left,
       (select count(*) from byo.conn_pool where status = 'available') as connections_available;
