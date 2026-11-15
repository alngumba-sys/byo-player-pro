-- ============================================================================
-- Reactivate a customer on a NEW device with the code the new device shows.
--
-- A customer who was activated by a salesperson and is still inside the activated period (trial or paid)
-- may reinstall, clear the app or switch phone. The new install shows a 4 digit "Activate your device" code.
-- The salesperson opens that customer in their portal, types the code, and:
--   * the customer's referral moves to the new device (same customer, same count, same commission history)
--   * the SAME connection from the pool follows (no second connection is used)
--   * the remaining trial / paid time is copied to the new device (it is never extended or restarted)
--   * payments made from the old device are re-homed, so the commission already earned is kept
--   * the new app picks the connection up by itself and leaves the setup screen
-- A salesperson can only do this for their own customers, only while the activated period has not ended,
-- and only with a code that is live (waiting, not expired). The code is used up afterwards.
--
--   public.byo_sales_reactivate(p_token text, p_rid uuid, p_code text)
--
-- Builds on 0019 / 0024. Nothing is renamed. Safe to run more than once. Run in the Supabase SQL Editor for BYO Tv.
-- ============================================================================
alter table byo.provisions add column if not exists moved_from text;
alter table byo.provisions add column if not exists moved_at timestamptz;

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
    v_new := s.device_key;
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
