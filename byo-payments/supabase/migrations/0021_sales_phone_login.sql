-- ============================================================================
-- Salespeople sign in with their PHONE NUMBER (email still works).
--   * byo.sales_agents.phone / phone_key (last 9 digits, unique: 0712 345 678, +254 712 345 678 and 254712345678 are the same person)
--   * Console: create a salesperson with a phone number. Their first password is the LAST 4 DIGITS of the phone number,
--     and they must choose a new one (8+ characters) the first time they sign in. Until they do, nothing else works for them.
--   * Console: "Reset password" sets it back to the last 4 digits (and forces a new one again).
--   * public.byo_sales_login(identifier, password): identifier is a phone number or an email
--   * public.byo_sales_change_password(token, old, new)
-- Builds on 0018 and 0019. Run it once. Order does not matter relative to 0020.
-- ============================================================================
alter table byo.sales_agents alter column email drop not null;
alter table byo.sales_agents add column if not exists phone text;
alter table byo.sales_agents add column if not exists phone_key text;
alter table byo.sales_agents add column if not exists must_change boolean not null default false;
create unique index if not exists sales_agents_phone_key on byo.sales_agents (phone_key);

-- an agent who still has the default password cannot use anything except changing it
create or replace function byo._agent(p_token text) returns byo.sales_agents
language sql stable security definer set search_path = byo, public, extensions as $$
    select g.* from byo.sales_agents g join byo.sales_sessions s on s.agent_id = g.id
     where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') and s.expires_at > now() and g.active and not g.must_change limit 1;
$$;
revoke all on function byo._agent(text) from public, anon, authenticated;

create or replace function byo._agent_any(p_token text) returns byo.sales_agents
language sql stable security definer set search_path = byo, public, extensions as $$
    select g.* from byo.sales_agents g join byo.sales_sessions s on s.agent_id = g.id
     where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') and s.expires_at > now() and g.active limit 1;
$$;
revoke all on function byo._agent_any(text) from public, anon, authenticated;

create or replace function public.byo_sales_login(p_email text, p_password text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; v_id text := btrim(coalesce(p_email,'')); v_digits text := regexp_replace(btrim(coalesce(p_email,'')), '\D', '', 'g'); v_tok text;
begin
    if position('@' in v_id) > 0 then select * into a from byo.sales_agents where lower(email) = lower(v_id);
    elsif length(v_digits) >= 9 then select * into a from byo.sales_agents where phone_key = right(v_digits, 9); end if;
    if a.id is null then perform pg_sleep(0.4); return jsonb_build_object('ok', false, 'error', 'Wrong phone number or password.'); end if;
    if a.fails >= 8 and a.last_fail > now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'error', 'Too many tries. Wait 15 minutes and try again.'); end if;
    if not a.active or a.pass_hash <> crypt(coalesce(p_password,''), a.pass_hash) then
        update byo.sales_agents set fails = case when last_fail > now() - interval '15 minutes' then fails + 1 else 1 end, last_fail = now() where id = a.id;
        return jsonb_build_object('ok', false, 'error', case when a.active then 'Wrong phone number or password.' else 'This account is switched off.' end);
    end if;
    v_tok := encode(gen_random_bytes(32), 'hex');
    insert into byo.sales_sessions(token_hash, agent_id, expires_at) values (encode(digest(v_tok, 'sha256'), 'hex'), a.id, now() + interval '30 days');
    delete from byo.sales_sessions where expires_at < now();
    update byo.sales_agents set fails = 0, last_login = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', v_tok, 'must_change', a.must_change);
end $$;
revoke all on function public.byo_sales_login(text,text) from public;
grant execute on function public.byo_sales_login(text,text) to anon, authenticated;

create or replace function public.byo_sales_change_password(p_token text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents;
begin
    a := byo._agent_any(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    if a.pass_hash <> crypt(coalesce(p_old,''), a.pass_hash) then return jsonb_build_object('ok', false, 'error', 'Your current password is not right.'); end if;
    if length(coalesce(p_new,'')) < 8 then return jsonb_build_object('ok', false, 'error', 'Your new password must be at least 8 characters.'); end if;
    if p_new = p_old then return jsonb_build_object('ok', false, 'error', 'Choose a different password from the one you were given.'); end if;
    update byo.sales_agents set pass_hash = crypt(p_new, gen_salt('bf')), must_change = false, fails = 0 where id = a.id;
    delete from byo.sales_sessions where agent_id = a.id and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
    return jsonb_build_object('ok', true);
end $$;
revoke all on function public.byo_sales_change_password(text,text,text) from public;
grant execute on function public.byo_sales_change_password(text,text,text) to anon, authenticated;

-- (the console create / reset / list actions live in 0022_admin_chain.sql)
notify pgrst, 'reload schema';
