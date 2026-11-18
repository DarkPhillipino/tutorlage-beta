-- Rolled-back test of migrations 20261118160000_paying_customers.sql and 20261118180000_paying_customers_real_money.sql (SHOULD batch A item 5, 18 Nov 2026; admin credits never count): who counts as a paying customer, who never does, and who may read the count.
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/paying_customers.sql supabase/migrations/20261118180000_paying_customers_real_money.sql   (160000 is already applied)
-- After the apply, paste this file alone. Made-up people only (example.invalid); nothing real is touched (the real count is measured first and only compared by difference); the block ends with `raise exception`.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  adult text := ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text;
  v_fin uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid(); v_off uuid := gen_random_uuid(); v_tut uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); pc uuid := gen_random_uuid(); pd uuid := gen_random_uuid(); pf uuid := gen_random_uuid();
  pg uuid := gen_random_uuid(); ph uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); pk uuid := gen_random_uuid(); pm uuid := gen_random_uuid(); pn uuid := gen_random_uuid(); po uuid := gen_random_uuid();
  base int; base_top int; base_req int; t text; j jsonb;
  t_state text;
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then
          perform set_config('request.jwt.claims', '', true);
          set local role anon;
        else
          perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;
        begin
          execute p_sql into v;
          reset role;
          return coalesce(v, 'null');
        exception when others then
          reset role;
          return 'ERR: ' || sqlerrm;
        end;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.mkq(p_payer uuid, p_status text, p_pay text, p_free boolean default false) returns uuid language plpgsql as $f$
      declare v uuid;
      begin
        insert into public.session_requests (student_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, free_session)
        values (p_payer, p_payer, now() + interval '5 days', 1, p_status, p_pay, 'sr_' || gen_random_uuid(), '1A', 1, 50, p_free)
        returning id into v;
        return v;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.mktop(p_payer uuid, p_status text) returns void language plpgsql as $f$
      begin
        insert into public.wallet_topups (profile_id, method, reference, amount_rand, status, received_rand, ledger_id, decided_at)
        values (p_payer, 'eft', 'TL-' || translate(upper(substr(md5(gen_random_uuid()::text), 1, 6)), '01IO', 'ZZZZ'), 500, p_status, case when p_status = 'successful' then 500 end, case when p_status = 'successful' then gen_random_uuid() end, case when p_status = 'successful' then now() end);
      end $f$ $mk$;

    -- the real count right now (read only); every check below is a DIFFERENCE from it
    select count(*) into base from public.paying_customer_ids();
    r := r || format('S0 real paying customers now (info): %s', base) || E'\n';

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x.id, z, 'authenticated', 'authenticated', 'pc.' || x.k || '.' || uid || '@example.invalid',
           jsonb_build_object('role', x.role, 'first_name', 'Zz' || x.k, 'surname', 'Test', 'date_of_birth', adult), '{}'
      from (values (pa, 'a', 'parent'), (pb, 'b', 'parent'), (pc, 'c', 'parent'), (pd, 'd', 'parent'), (pf, 'f', 'parent'), (pg, 'g', 'parent'), (ph, 'h', 'parent'),
                   (pj, 'j', 'parent'), (pk, 'k', 'parent'), (pm, 'm', 'parent'), (pn, 'n', 'parent'), (po, 'o', 'parent'), (v_fin, 'fin', 'parent'), (v_sup, 'sup', 'parent'), (v_off, 'off', 'parent'), (v_tut, 'tut', 'tutor')) x(id, k, role);
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_fin, 'Fin', 'Manager', 'pc.fin.' || uid || '@example.invalid', '', 'finance_manager', true),
      (v_sup, 'Sue', 'Support', 'pc.sup.' || uid || '@example.invalid', '', 'support_agent', true),
      (v_off, 'Vic', 'Officer', 'pc.off.' || uid || '@example.invalid', '', 'verification_officer', true);
    r := r || 'S1 setup: a finance manager, a support agent, an officer (who also pays: must not count), a tutor and 10 made-up payers' || E'\n';

    perform pg_temp.mktop(pa, 'successful');                                   -- counts (credited top-up)
    perform pg_temp.mktop(pb, 'cancelled');                                    -- a cancelled top-up: does not
    perform pg_temp.mktop(pb, 'awaiting_proof');                               -- a waiting top-up: does not
    perform pg_temp.mkq(pc, 'accepted', 'paid');                               -- counts (card-paid request a tutor accepted)
    perform pg_temp.mkq(pd, 'pending', 'card_verified');                       -- funded but nobody accepted yet: does not
    perform pg_temp.mkq(pd, 'expired', 'card_verified');                       -- expired: does not
    perform pg_temp.mkq(pd, 'cancelled', 'card_verified');                     -- cancelled: does not
    perform pg_temp.mktop(pf, 'successful'); perform pg_temp.mktop(pf, 'successful');
    perform pg_temp.mkq(pf, 'accepted', 'wallet_paid'); perform pg_temp.mkq(pf, 'accepted', 'paid');   -- paid many times: counts ONCE
    insert into review_accounts (user_id, purpose, expires_at) values (pg, 'parent', now() + interval '30 days');
    perform pg_temp.mktop(pg, 'successful');                                   -- a Demo/review account: never
    insert into wallet_online_staff (profile_id, note) values (ph, 'zz staff');
    perform pg_temp.mktop(ph, 'successful');                                   -- staff who test online payment: never
    perform pg_temp.mkq(v_off, 'accepted', 'paid');                            -- an admin account: never
    insert into paying_customer_exclusions (profile_id, reason) values (pj, 'zz the CEO''s own account');
    perform pg_temp.mktop(pj, 'successful');                                   -- listed as excluded: never
    perform pg_temp.mkq(pk, 'accepted', 'paid', true);                         -- a free session marked paid: does not
    -- an admin gift: a ledger 'adjustment' (never a top-up row), spent on a request paid from the wallet: the request alone must NOT make pn a customer
    perform pg_temp.mkq(pn, 'accepted', 'wallet_paid');
    insert into public.wallet_ledger (profile_id, kind, available_delta, held_delta, available_after, held_after, actor_id, note, idempotency_key)
      values (pn, 'adjustment', 500, 0, 500, 0, v_fin, 'zz admin gift', 'zz-gift-' || uid);
    -- real money (a credited top-up) then spent from the wallet: counts once, through the top-up
    perform pg_temp.mktop(po, 'successful'); perform pg_temp.mkq(po, 'accepted', 'wallet_paid');
    perform pg_temp.mkq(pm, 'accepted', 'initiated');                          -- accepted but never paid: does not

    r := r || pg_temp.chk('P1', 'exactly four of the made-up people count (credited top-up; accepted CARD-paid request; the one who paid many times, once; real money then spent from the wallet, once)', ((select count(*) from public.paying_customer_ids()) - base)::text, '4');
    r := r || pg_temp.chk('P2', 'the four are pa, pc, pf, po',
      (select string_agg(k, ',' order by k) from (select case i.profile_id when pa then 'a' when pc then 'c' when pf then 'f' when po then 'o' end k from public.paying_customer_ids() i where i.profile_id in (pa, pb, pc, pd, pf, pg, ph, pj, pk, pm, pn, po, v_off)) q), 'a,c,f,o');
    r := r || pg_temp.chk('P3', 'a review account, a staff payer, an admin, an excluded account, a free session, an unpaid acceptance, an ADMIN GIFT spent on a wallet-paid request, a cancelled/waiting top-up: none counted',
      (select count(*) from public.paying_customer_ids() i where i.profile_id in (pb, pd, pg, ph, pj, pk, pm, pn, v_off))::text, '0');

    -- who may read it
    t := pg_temp.run_as(v_fin, 'select public.admin_paying_customers()::text');
    j := t::jsonb;
    r := r || pg_temp.chk('P4', 'a finance manager reads the count; it is the real count plus the 4', (j ->> 'count'), (base + 4)::text);
    r := r || pg_temp.chk('P5', 'the answer carries the two thresholds and the state (ok far below 9,500)', (j ->> 'warn_at') || '/' || (j ->> 'end_at') || '/' || (j ->> 'state'), '9500/10000/ok');
    r := r || pg_temp.chk('P6', 'it says how many accounts are excluded (the real ones, which include the account of the CEO, plus the made-up one) and the parts add up (top-ups + requests >= count)',
      (j ->> 'excluded_accounts') || '/' || (((j ->> 'from_topups')::int + (j ->> 'from_requests')::int) >= (j ->> 'count')::int)::text, (select count(*) from public.paying_customer_exclusions)::text || '/true');
    r := r || pg_temp.chk('P7', 'it says how many promo codes are switched on (a number)', ((j ->> 'active_codes') ~ '^[0-9]+$')::text, 'true');
    r := r || pg_temp.chk('P8', 'a support agent cannot read it', pg_temp.run_as(v_sup, 'select public.admin_paying_customers()::text'), 'ERR: Only a finance manager or a super admin can see this');
    r := r || pg_temp.chk('P9', 'a verification officer cannot either', pg_temp.run_as(v_off, 'select public.admin_paying_customers()::text'), 'ERR: Only a finance manager or a super admin can see this');
    r := r || pg_temp.chk('P10', 'a tutor cannot', pg_temp.run_as(v_tut, 'select public.admin_paying_customers()::text'), 'ERR: Admins only');
    r := r || pg_temp.chk('P11', 'signed out cannot call it', has_function_privilege('anon', 'public.admin_paying_customers()', 'execute')::text || '/' || has_function_privilege('service_role', 'public.admin_paying_customers()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_paying_customers()', 'execute')::text, 'false/false/true');
    r := r || pg_temp.chk('P12', 'the internal list is callable by nobody',
      has_function_privilege('anon', 'public.paying_customer_ids()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.paying_customer_ids()', 'execute')::text || '/' || has_function_privilege('service_role', 'public.paying_customer_ids()', 'execute')::text, 'false/false/false');
    r := r || pg_temp.chk('P13', 'the exclusion table has no right for any API role and a tutor cannot read it',
      has_table_privilege('anon', 'public.paying_customer_exclusions', 'select')::text || '/' || has_table_privilege('authenticated', 'public.paying_customer_exclusions', 'select')::text || '/' || has_table_privilege('service_role', 'public.paying_customer_exclusions', 'select')::text || '/' || pg_temp.run_as(v_tut, 'select count(*)::text from public.paying_customer_exclusions'),
      'false/false/false/ERR: permission denied for table paying_customer_exclusions');
    r := r || pg_temp.chk('P14', 'the thresholds in the function are 9,500 and 10,000 and it changes nothing (stable, no writes)',
      (position('c_warn constant integer := 9500' in pg_get_functiondef('public.admin_paying_customers()'::regprocedure)) > 0 and position('c_end constant integer := 10000' in pg_get_functiondef('public.admin_paying_customers()'::regprocedure)) > 0 and (select provolatile from pg_proc where oid = 'public.admin_paying_customers()'::regprocedure) = 's')::text, 'true');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
