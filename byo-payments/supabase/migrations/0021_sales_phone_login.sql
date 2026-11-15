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

-- ---------------------------------------------------------------- console
do $$ begin
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'byo_support_admin' and position('phone-wrapper' in prosrc) = 0) then
        drop function if exists byo._support_admin_pre_phone(text, jsonb);
        alter function public.byo_support_admin(text, jsonb) rename to _support_admin_pre_phone;
        alter function public._support_admin_pre_phone(text, jsonb) set schema byo;
    end if;
end $$;
revoke all on function byo._support_admin_pre_phone(text, jsonb) from public, anon, authenticated;

create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- phone-wrapper: salespeople with a phone number; everything else goes to byo._support_admin_pre_phone
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_digits text; v_key text; v_name text; v_email text; v_code text; v_pct numeric; v_act boolean; v_id uuid; v_last4 text; r jsonb;
begin
    if p_action = 'fleet.sales_list' then
        r := byo._support_admin_pre_phone(p_action, p_args);
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

    return byo._support_admin_pre_phone(p_action, p_args);
end $$;
revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;
notify pgrst, 'reload schema';
