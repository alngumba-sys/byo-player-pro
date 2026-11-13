-- Fix for 0018: in fleet.sales_list the aliases c and s clashed with the variable c declared in byo_support_admin
-- ("column reference c is ambiguous"). Run once in the Supabase SQL Editor for BYO Tv.
do $$
declare d text; o text := $o$jsonb_object_agg(c, s), '{}'::jsonb) from (select p.currency c, sum(p.amount) s from byo.pay_received p join byo.referrals r on r.device_key = p.device_key where r.agent_id = g.id$o$;
        n text := $n$jsonb_object_agg(cur, amt), '{}'::jsonb) from (select p.currency cur, sum(p.amount) amt from byo.pay_received p join byo.referrals r on r.device_key = p.device_key where r.agent_id = g.id$n$;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname='byo_support_admin' and pronamespace='public'::regnamespace;
  if (length(d) - length(replace(d, o, ''))) <> length(o) then raise exception 'anchor not unique or already fixed'; end if;
  execute replace(d, o, n);
end $$;
