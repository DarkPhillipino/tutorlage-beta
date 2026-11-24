-- Rolled-back test of migration 20261124120000_public_tutor_profile.sql (job P slice 1, 24 Nov 2026). Run it TOGETHER with the migration (one statement; the last line raises so everything is undone)
-- or alone after the apply. Made-up tutors only, with codes that start ZZ so a real code can never be hit.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); tc uuid := gen_random_uuid(); td uuid := gen_random_uuid(); lrn uuid := gen_random_uuid();
  ca text := 'ZZPUBA' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  cb text := 'ZZPUBB' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  cd text := 'ZZPUBD' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  j jsonb; t text; ymon text;
  nfail int; nlines int;
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
    select x, z, 'authenticated', 'authenticated', 'pp.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb, tc, td]) x;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (lrn, z, 'authenticated', 'authenticated', 'pp.l.' || lrn || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}');
    update profiles set full_name = 'Tessa Surnamesson' where id = ta;
    update profiles set full_name = 'Bongani Dlamini' where id = tb;
    update tutor_profiles set is_verified = true, current_tier_id = 1, current_sub_tier_id = '1A' where id = any (array[ta, tb, td]);
    update tutor_profiles set is_verified = false where id = tc;
    -- approval makes a code by itself (one per tutor); take what exists, make one only where there is none
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZPUB' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb, tc, td]) x
       where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    select code into ca from promo_codes where owner_tutor_id = ta;
    select code into cb from promo_codes where owner_tutor_id = tb;
    select code into cd from promo_codes where owner_tutor_id = td;
    insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
      (ta, 'Mathematics', 'caps', 'Grade 8', 'Grade 12', 'verified'),
      (ta, 'Physical Sciences', 'caps', 'Grade 10', 'Grade 12', 'pending'),
      (ta, 'Life Sciences', 'caps', 'Grade 10', 'Grade 12', 'rejected');
    insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
      select ta, d, '17:00', '23:00' from unnest(array[1, 2, 3, 4, 5]) d;
    insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (ta, 6, '08:00', '12:00'), (ta, 6, '14:00', '17:30'), (ta, 0, '08:00', '12:00'), (ta, 0, '14:00', '17:30');
    insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on) values
      (ta, 'identity_doc', 'fixture/id-a', 'verified', null),
      (ta, 'matric_certificate', 'fixture/m-a', 'verified', null),
      (ta, 'police_clearance', 'fixture/p-a', 'verified', (now() at time zone 'Africa/Johannesburg')::date - 20),
      (tb, 'identity_doc', 'fixture/id-b', 'pending', null),
      (tb, 'police_clearance', 'fixture/p-b', 'verified', ((now() at time zone 'Africa/Johannesburg')::date - interval '7 months')::date);

    -- A. private by default; the same empty answer for every kind of "no"
    r := r || pg_temp.chk('A1', 'a tutor with a code who has not switched it on: nothing', coalesce(public.public_tutor_page(ca)::text, 'null'), 'null');
    r := r || pg_temp.chk('A2', 'an unknown code: the same nothing', coalesce(public.public_tutor_page('ZZNOSUCHCODE')::text, 'null'), 'null');
    r := r || pg_temp.chk('A3', 'an empty or odd code: the same', coalesce(public.public_tutor_page('')::text, 'null') || '/' || coalesce(public.public_tutor_page(null)::text, 'null'), 'null/null');
    r := r || pg_temp.chk('A4', 'the table is closed to the app (read and write)', has_table_privilege('authenticated', 'public.tutor_public_profile', 'select')::text || '/' || has_table_privilege('anon', 'public.tutor_public_profile', 'select')::text
      || '/' || has_table_privilege('authenticated', 'public.tutor_public_profile', 'insert')::text, 'false/false/false');
    r := r || pg_temp.chk('A5', 'the helpers cannot be called by the app', has_function_privilege('authenticated', 'public.tutor_checked_lines(uuid)', 'execute')::text || '/' || has_function_privilege('anon', 'public.tutor_hours_in_words(uuid)', 'execute')::text, 'false/false');
    r := r || pg_temp.chk('A6', 'the public answer is open to a visitor with no sign-in; the switch is not', has_function_privilege('anon', 'public.public_tutor_page(text)', 'execute')::text || '/' || has_function_privilege('anon', 'public.set_my_public_profile(boolean)', 'execute')::text || '/' || has_function_privilege('anon', 'public.my_public_profile()', 'execute')::text, 'true/false/false');

    -- B. who can switch it on
    r := r || pg_temp.chk('B1', 'her own state before: can be public, is not', pg_temp.run_as(ta, 'select (public.my_public_profile() ->> ''can_be_public'') || ''/'' || (public.my_public_profile() ->> ''is_public'')'), 'true/false');
    r := r || pg_temp.chk('B2', 'a learner cannot', left(pg_temp.run_as(lrn, 'select public.set_my_public_profile(true)::text'), 36), 'ERR: Only a tutor has a public page');
    r := r || pg_temp.chk('B3', 'a tutor who is not approved cannot', left(pg_temp.run_as(tc, 'select public.set_my_public_profile(true)::text'), 38), 'ERR: Your page can be switched on once');
    r := r || pg_temp.chk('B4', 'a visitor who is not signed in cannot', left(pg_temp.run_as(null, 'select public.set_my_public_profile(true)::text'), 30), 'ERR: permission denied for fun');
    t := pg_temp.run_as(ta, 'select public.set_my_public_profile(true)::text');
    r := r || pg_temp.chk('B5', 'an approved tutor with a code switches it on', t, '');
    r := r || pg_temp.chk('B6', 'her state after, and the consent is recorded', pg_temp.run_as(ta, 'select (public.my_public_profile() ->> ''is_public'')') || '/' || (select (consent_at is not null)::text || (withdrawn_at is null)::text from public.tutor_public_profile where tutor_id = ta), 'true/truetrue');

    -- C. what the page says
    j := public.public_tutor_page(lower(ca));
    r := r || pg_temp.chk('C1', 'the code is read in any case and gives the page', (j is not null)::text, 'true');
    r := r || pg_temp.chk('C2', 'the first name only', j ->> 'first_name', 'Tessa');
    r := r || pg_temp.chk('C3', 'the fixed set of keys, nothing else', (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k), 'checked,code,currency,first_name,hours,level_id,level_name,price,subjects,taking_requests');
    r := r || pg_temp.chk('C4', 'no surname, e-mail address or learner anywhere in the answer', (j::text ilike '%surnamesson%' or j::text ilike '%example.invalid%' or j::text ilike '%' || lrn::text || '%' or j::text ilike '%' || ta::text || '%')::text, 'false');
    r := r || pg_temp.chk('C5', 'only the VERIFIED subject, with its grades', (select string_agg((s ->> 'subject') || ' ' || (s ->> 'min_grade') || '-' || (s ->> 'max_grade'), ',') from jsonb_array_elements(j -> 'subjects') s), 'Mathematics Grade 8-Grade 12');
    r := r || pg_temp.chk('C6', 'the level and its price are the same as the Prices page reads', (j ->> 'level_id') || ' ' || (j ->> 'level_name') || ' ' || (j ->> 'price') || ' ' || (j ->> 'currency'),
      (select s.id || ' ' || t.public_name || ' ' || s.max_allowed_rate::text || ' ' || trim(t.currency_code) from sub_tier_definitions s join tier_definitions t on t.id = s.tier_id where s.id = '1A'));
    ymon := to_char((now() at time zone 'Africa/Johannesburg')::date - 20, 'FMMonth YYYY');
    r := r || pg_temp.chk('C7', 'the checked lines, in the agreed words, with the month the certificate was issued', (select string_agg(x, ' | ' order by x) from jsonb_array_elements_text(j -> 'checked') x), 'ID checked | Police clearance checked, ' || ymon || ' | Results or qualification checked');
    r := r || pg_temp.chk('C8', 'never "vetted", "certified" or "background-checked", anywhere in the answer', (j::text ~* '(vetted|certified|background)')::text, 'false');
    r := r || pg_temp.chk('C9', 'the hours in words (a day with two ranges reads as two)', j ->> 'hours', 'Monday to Friday, 5pm to 11pm; Saturday and Sunday, 8am to 12pm and 2pm to 5:30pm');
    r := r || pg_temp.chk('C10', 'she takes requests (she has hours)', j ->> 'taking_requests', 'true');

    -- D. the checks follow the documents live
    update tutor_verification_documents set issued_on = ((now() at time zone 'Africa/Johannesburg')::date - interval '7 months')::date where tutor_id = ta and document_type::text = 'police_clearance';
    r := r || pg_temp.chk('D1', 'a police clearance older than 6 months KEEPS its line (24 Nov 2026: its age matters only at registration; the month is the month it was issued)', (select string_agg(x, ' | ' order by x) from jsonb_array_elements_text(public.public_tutor_page(ca) -> 'checked') x), 'ID checked | Police clearance checked, ' || to_char(((now() at time zone 'Africa/Johannesburg')::date - interval '7 months')::date, 'FMMonth YYYY') || ' | Results or qualification checked');
    update tutor_verification_documents set status = 'rejected' where tutor_id = ta and document_type::text = 'matric_certificate';
    r := r || pg_temp.chk('D2', 'a results document that is no longer verified drops its line', (select string_agg(x, ' | ' order by x) from jsonb_array_elements_text(public.public_tutor_page(ca) -> 'checked') x), 'ID checked | Police clearance checked, ' || to_char(((now() at time zone 'Africa/Johannesburg')::date - interval '7 months')::date, 'FMMonth YYYY'));
    delete from tutor_availability where tutor_id = ta;
    r := r || pg_temp.chk('D3', 'no hours: the page says so and she is not "taking requests"', coalesce(public.public_tutor_page(ca) ->> 'hours', 'null') || '/' || (public.public_tutor_page(ca) ->> 'taking_requests'), 'null/false');

    -- E. withdrawal, and the other tutors
    r := r || pg_temp.chk('E1', 'a tutor with a pending ID has no ID line (and has not switched on: no page)', coalesce(public.public_tutor_page(cb)::text, 'null'), 'null');
    t := pg_temp.run_as(tb, 'select public.set_my_public_profile(true)::text');
    r := r || pg_temp.chk('E2', 'a second tutor switches on: only checks that are true: none for the pending ID; the old but verified certificate keeps its line', (select count(*)::text from jsonb_array_elements_text(public.public_tutor_page(cb) -> 'checked')), '1');
    r := r || pg_temp.chk('E3', 'her first name comes from her own name, not from another tutor', public.public_tutor_page(cb) ->> 'first_name', 'Bongani');
    t := pg_temp.run_as(ta, 'select public.set_my_public_profile(false)::text');
    r := r || pg_temp.chk('E4', 'switching off hides her page at once and records the withdrawal', coalesce(public.public_tutor_page(ca)::text, 'null') || '/' || (select (withdrawn_at is not null)::text || (consent_at is not null)::text || (not is_public)::text from public.tutor_public_profile where tutor_id = ta), 'null/truetruetrue');
    update tutor_profiles set is_verified = false where id = tb;
    r := r || pg_temp.chk('E5', 'a tutor who stops being verified disappears even with the switch on', coalesce(public.public_tutor_page(cb)::text, 'null'), 'null');
    update tutor_profiles set is_verified = true, current_sub_tier_id = '4C' where id = tb;
    r := r || pg_temp.chk('E6', 'a hidden Tier 4 level never has a page, and cannot switch on', coalesce(public.public_tutor_page(cb)::text, 'null') || '/' || pg_temp.run_as(tb, 'select (public.my_public_profile() ->> ''can_be_public'')'), 'null/false');
    update promo_codes set active = false where code = ca;
    t := pg_temp.run_as(ta, 'select public.set_my_public_profile(true)::text');
    r := r || pg_temp.chk('E7', 'a tutor whose code is switched off cannot go public', left(t, 38), 'ERR: Your page can be switched on once');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
