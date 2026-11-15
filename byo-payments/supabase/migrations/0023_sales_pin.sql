-- 0023: the password a salesperson chooses at first sign-in is now a 4-digit PIN.
-- Only replaces public.byo_sales_change_password. Safe to run more than once.
-- It does not touch the console function chain (0022).

create or replace function public.byo_sales_change_password(p_token text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents;
begin
    a := byo._agent_any(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    if a.pass_hash <> crypt(coalesce(p_old,''), a.pass_hash) then return jsonb_build_object('ok', false, 'error', 'Your current password is not right.'); end if;
    if coalesce(p_new,'') !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'error', 'Your new PIN must be exactly 4 digits.'); end if;
    if p_new = p_old then return jsonb_build_object('ok', false, 'error', 'Choose a different PIN from the one you were given.'); end if;
    update byo.sales_agents set pass_hash = crypt(p_new, gen_salt('bf')), must_change = false, fails = 0 where id = a.id;
    delete from byo.sales_sessions where agent_id = a.id and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
    return jsonb_build_object('ok', true);
end $$;
revoke all on function public.byo_sales_change_password(text,text,text) from public;
grant execute on function public.byo_sales_change_password(text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
