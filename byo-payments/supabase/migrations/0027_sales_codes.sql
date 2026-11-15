-- ============================================================================
-- 0027: the activation code in the salesperson's customer list, and reactivation that follows the app's real device id.
--
--   * public.byo_sales_codes(p_token): for each of the salesperson's customers whose app is showing an activation code
--     right now (waiting, not expired), that 4 digit code. The portal shows it instead of the device id.
--   * public.byo_sales_reactivate is replaced: the new device is the app's real device id (sent with the code as
--     device_id), not the temporary activation key. Apps that do not send it (older versions) get a clear message.
--
-- Builds on 0026. Nothing is renamed. Safe to run more than once. Run in the Supabase SQL Editor for BYO Tv.
-- ============================================================================

create or replace function public.byo_sales_codes(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; v jsonb;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    select coalesce(jsonb_object_agg(x.rid, x.code), '{}'::jsonb) into v from (
        select distinct on (r.id) r.id::text as rid, s.code
          from byo.referrals r
          join byo.support_sessions s on s.device_state->>'device_id' = r.device_key
         where r.agent_id = a.id and s.status = 'waiting' and s.expires_at > now()
         order by r.id, s.created_at desc) x;
    return jsonb_build_object('ok', true, 'codes', v);
end $$;
revoke all on function public.byo_sales_codes(text) from public;
grant execute on function public.byo_sales_codes(text) to anon, authenticated;

create or replace function public.byo_sales_reactivate(p_token text, p_rid uuid, p_code text)
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
    v_new := nullif(s.device_state->>'device_id', '');
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
revoke all on function public.byo_sales_reactivate(text, uuid, text) from public;
grant execute on function public.byo_sales_reactivate(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
