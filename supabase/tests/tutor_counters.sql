-- Rolled-back test of migration 20261124230000_tutor_counters.sql (JOB COUNTERS, 24 Nov 2026). Run TOGETHER with the migration through scripts/run-rolled-back-test.mjs; the last line raises so everything is undone.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); lrn uuid := gen_random_uuid(); a_fin uuid := gen_random_uuid(); a_spt uuid := gen_random_uuid();
  ca text; cb text; cid uuid; j jsonb; nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then perform set_config('request.jwt.claims', '', true); set local role anon;
        else perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated; end if;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x, z, 'authenticated', 'authenticated', 'tc.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb]) x;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (lrn, z, 'authenticated', 'authenticated', 'tc.l.' || lrn || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}'),
      (a_fin, z, 'authenticated', 'authenticated', 'tc.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
      (a_spt, z, 'authenticated', 'authenticated', 'tc.a2.' || a_spt || '@example.invalid', '{}'::jsonb, '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (a_fin, 'Fin', 'Manager', 'tc.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
      (a_spt, 'Spt', 'Agent', 'tc.a2.' || a_spt || '@example.invalid', '', 'support_agent', true);
    update profiles set full_name = 'Tessa Surnamesson' where id = ta;
    update tutor_profiles set is_verified = true, current_tier_id = 1, current_sub_tier_id = '1A' where id = any (array[ta, tb]);
    -- since 24 Nov 2026 (JOB ON-BY-DEFAULT) approval itself switches the page on; this suite starts from "page off", so remove the rows approval made (rolled back with everything else)
    delete from tutor_public_profile where tutor_id = any (array[ta, tb]);
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZTC' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb]) x
       where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    select id, code into cid, ca from promo_codes where owner_tutor_id = ta;
    select code into cb from promo_codes where owner_tutor_id = tb;

    -- A. nothing counts while her page is off, or for a code that is not hers
    perform public.count_tutor_page_event(ca, 'page_open');
    r := r || pg_temp.chk('A1', 'page off: nothing is counted', (select count(*) from tutor_daily_counts where tutor_id = ta)::text, '0');
    insert into tutor_public_profile (tutor_id, is_public, consent_at) values (ta, true, now()), (tb, false, null) on conflict (tutor_id) do update set is_public = excluded.is_public;
    perform public.count_tutor_page_event('ZZNOSUCHCODE', 'page_open');
    perform public.count_tutor_page_event(null, 'page_open');
    perform public.count_tutor_page_event(ca, 'something_else');
    perform public.count_tutor_page_event(ca, null);
    perform public.count_tutor_page_event(cb, 'page_open');
    r := r || pg_temp.chk('A2', 'an unknown code, an empty code, an odd kind, a tutor whose page is off: nothing is counted and nothing is said (this run''s two made-up tutors only: production holds real counts)', (select count(*) from tutor_daily_counts where tutor_id = any (array[ta, tb]))::text, '0');

    -- B. a visitor who is not signed in counts opens and taps; the case of the code does not matter
    r := r || pg_temp.chk('B1', 'a visitor can call it', pg_temp.run_as(null, format('select public.count_tutor_page_event(%L, ''page_open'')::text', lower(ca))), '');
    perform pg_temp.run_as(null, format('select public.count_tutor_page_event(%L, ''page_open'')::text', ca));
    perform pg_temp.run_as(null, format('select public.count_tutor_page_event(%L, ''book_tap'')::text', ca));
    r := r || pg_temp.chk('B2', 'two opens and one tap are counted, today (SAST), as numbers', (select string_agg(kind || '=' || n, ',' order by kind) from tutor_daily_counts where tutor_id = ta and day = (now() at time zone 'Africa/Johannesburg')::date), 'book_tap=1,page_open=2');
    r := r || pg_temp.chk('B3', 'the table holds only four columns: tutor, day, kind, number (no visitor id, address, device or time)', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'tutor_daily_counts'), 'tutor_id,day,kind,n');
    r := r || pg_temp.chk('B4', 'the table is closed to the app (read and write)', has_table_privilege('authenticated', 'public.tutor_daily_counts', 'select')::text || '/' || has_table_privilege('anon', 'public.tutor_daily_counts', 'select')::text || '/' || has_table_privilege('authenticated', 'public.tutor_daily_counts', 'insert')::text, 'false/false/false');
    r := r || pg_temp.chk('B5', 'the family helper cannot be called by the app', has_function_privilege('authenticated', 'public.tutor_family_counts(uuid,date,date)', 'execute')::text || '/' || has_function_privilege('anon', 'public.tutor_family_counts(uuid,date,date)', 'execute')::text, 'false/false');

    -- C. the family numbers come from what already exists
    update profiles set promo_code_id = cid, promo_code_entered = ca, promo_attached_at = now() where id = lrn;
    r := r || pg_temp.chk('C1', 'her own totals: opens, taps and one sign-up, numbers only', pg_temp.run_as(ta, 'select (public.my_tutor_counts() - ''x'')::text'), '{"signup": 1, "book_tap": 1, "page_open": 2}');
    r := r || pg_temp.chk('C2', 'another tutor sees none of it', pg_temp.run_as(tb, 'select public.my_tutor_counts()::text'), '{}');
    r := r || pg_temp.chk('C3', 'a learner gets nothing', pg_temp.run_as(lrn, 'select coalesce(public.my_tutor_counts()::text, ''null'')'), 'null');
    r := r || pg_temp.chk('C4', 'a visitor who is not signed in cannot read it', left(pg_temp.run_as(null, 'select public.my_tutor_counts()::text'), 30), 'ERR: permission denied for fun');

    -- D. the admin view
    j := (pg_temp.run_as(a_fin, 'select public.admin_tutor_counts()::text'))::jsonb;
    r := r || pg_temp.chk('D1', 'a finance admin reads her totals', (select (t -> 'totals')::text from jsonb_array_elements(j -> 'tutors') t where t ->> 'tutor_id' = ta::text), '{"signup": 1, "book_tap": 1, "page_open": 2}');
    r := r || pg_temp.chk('D2', 'the admin answer has no e-mail address, phone number, surname or learner anywhere', (j::text ilike '%example.invalid%' or j::text ilike '%surnamesson%' or j::text ilike '%' || lrn::text || '%')::text, 'false');
    r := r || pg_temp.chk('D3', 'a support agent, a tutor and a visitor are refused', left(pg_temp.run_as(a_spt, 'select public.admin_tutor_counts()::text'), 26) || '/' || left(pg_temp.run_as(ta, 'select public.admin_tutor_counts()::text'), 26) || '/' || left(pg_temp.run_as(null, 'select public.admin_tutor_counts()::text'), 18), 'ERR: Finance admins only/ERR: Finance admins only/ERR: permission de');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
