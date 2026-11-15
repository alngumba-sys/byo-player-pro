-- ============================================================================
-- 0029: the portal also shows how long each activation code has left.
--   public.byo_sales_codes(p_token) now returns, next to "codes" (customer id -> 4 digit code), "secs"
--   (customer id -> seconds until that code expires). Older portal pages ignore the extra field.
-- Builds on 0028. Safe to run more than once. Run in the Supabase SQL Editor for BYO Tv.
-- ============================================================================

create or replace function public.byo_sales_codes(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; v jsonb; w jsonb;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    select coalesce(jsonb_object_agg(x.rid, x.code), '{}'::jsonb), coalesce(jsonb_object_agg(x.rid, x.secs), '{}'::jsonb) into v, w from (
        select distinct on (r.id) r.id::text as rid, s.code, greatest(0, floor(extract(epoch from (s.expires_at - now()))))::int as secs
          from byo.referrals r
          join byo.support_sessions s on (case when s.device_key like 'act-%' then s.device_state->>'device_id' else s.device_key end) = r.device_key
         where r.agent_id = a.id and s.status = 'waiting' and s.expires_at > now()
         order by r.id, s.created_at desc) x;
    return jsonb_build_object('ok', true, 'codes', v, 'secs', w);
end $$;
revoke all on function public.byo_sales_codes(text) from public;
grant execute on function public.byo_sales_codes(text) to anon, authenticated;

notify pgrst, 'reload schema';
