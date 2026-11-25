-- ROLLED BACK ONLY. Test of migration 20261125150000_tutor_page_booking.sql (JOB LINK, 25 Nov 2026). Run it TOGETHER with the migration through scripts/run-rolled-back-test.mjs, or inside
-- begin ... rollback; the last line raises so everything is undone. Never run bare on production. Made-up people only.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '40 years')::date::text;
  minor text := (current_date - interval '12 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); ln uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); ch uuid := gen_random_uuid(); lr uuid := gen_random_uuid(); ot uuid := gen_random_uuid(); ad uuid := gen_random_uuid();
  ccode text; bcode text; d_q uuid; e_ln uuid; e_ch uuid; e_lr uuid; q text; q2 text; t text; j jsonb; k jsonb; nfail int; nlines int; d3 text;
  m_str text := 'ERR: You can only ask for a tutor you have had a session with.';
  m_time text := 'ERR: This tutor isn''t available at that time. Choose another time, or send the request to any available tutor.';
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || case when p_got is not distinct from p_want then 'ok' else 'FAIL got ' || coalesce(p_got, 'null') || ' (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then perform set_config('request.jwt.claims', '', true); set local role anon;
        else perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated; end if;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;
    -- the booking page's own insert: addressed, no school, no curriculum, marked as from the page
    execute $mk$
      create function pg_temp.ask(p_payer uuid, p_learner uuid, p_tutor uuid, p_enr uuid, p_start timestamptz, p_page boolean default true) returns text language plpgsql as $f$
      begin
        return pg_temp.run_as(p_payer, format('insert into public.session_requests (student_id, requested_by_profile_id, requested_tutor_id, enrollment_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, via_tutor_page) values (%L, %L, %L, %L, %L, 1, %L, ''1A'', %L) returning id::text',
          p_learner, p_payer, p_tutor, p_enr, p_start, 'zzlink_' || replace(gen_random_uuid()::text, '-', ''), p_page));
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.at_sa(p_days int, p_time text) returns timestamptz language sql as $f$
        select (((now() at time zone 'Africa/Johannesburg')::date + p_days) + p_time::time) at time zone 'Africa/Johannesburg' $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x.id, z, 'authenticated', 'authenticated', 'link.' || x.id || '@example.invalid', jsonb_build_object('role', x.role, 'first_name', x.first, 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'
      from (values (ta, 'tutor', 'Odette'), (tb, 'tutor', 'Bo'), (ln, 'student', 'Nia'), (pa, 'parent', 'Pat'), (lr, 'student', 'Ria'), (ot, 'student', 'Otto'), (ad, 'student', 'Ada')) as x(id, role, first);
    update profiles set date_of_birth = adult::date where id in (ta, tb, ln, pa, lr, ot, ad);
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (ch, z, 'authenticated', 'authenticated', 'link.c.' || ch || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cy', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', pa, 'relationship', 'mother'));
    -- an older parent account, no code
    update profiles set created_at = now() - interval '60 days' where id = pa;
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values (ad, 'Ada', 'Officer', 'link.ad.' || ad || '@example.invalid', '', 'verification_officer', true);
    update profiles set full_name = 'odette surnamesson' where id = ta;
    update tutor_profiles set is_verified = true, current_tier_id = 2, current_sub_tier_id = '2C', credential_floor_sub_tier_id = null, institution_id = null where id = ta;
    update tutor_profiles set is_verified = true, current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id = tb;
    insert into tutor_credentials (tutor_id, credential_code, status, obtained_on, assigned_sub_tier_id, verified_at) values (ta, 'admin_assigned', 'verified', current_date, '2C', now());
    insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
      (ta, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified'), (tb, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified');
    insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select x, d, '10:00', '12:00' from generate_series(0, 6) d, unnest(array[ta, tb]) x;
    insert into tutor_public_profile (tutor_id, is_public) select x, true from unnest(array[ta, tb]) x on conflict (tutor_id) do update set is_public = true, withdrawn_at = null;
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZLK' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb]) x where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    update promo_codes set active = true, valid_from = now() - interval '1 day', valid_until = null, max_families = null where owner_tutor_id in (ta, tb);
    select code into ccode from promo_codes where owner_tutor_id = ta limit 1;
    select code into bcode from promo_codes where owner_tutor_id = tb limit 1;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ln, 'Zorology', 'Grade 10') returning id into e_ln;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ch, 'Zorology', 'Grade 10') returning id into e_ch;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (lr, 'Zorology', 'Grade 10') returning id into e_lr;
    perform public.wallet_post(x, 'topup', 5000, 0, 'link-top:' || x, null, 'test top-up') from unnest(array[ln, pa, lr]) x;

    -- A. the public page
    j := (pg_temp.run_as(null, format('select public.public_tutor_page(%L)::text', ccode)))::jsonb;
    r := r || pg_temp.chk('A1', 'name capitalised, no surname, no "checked" lines', (j ->> 'first_name') || '/' || (j::text not ilike '%surnamesson%')::text || '/' || (j ? 'checked')::text, 'Odette/true/false');
    r := r || pg_temp.chk('A2', 'only "level assigned": no basis, and the second tier''s line is not shown', coalesce(j ->> 'basis', 'none') || '/' || coalesce(j ->> 'tier_line', 'none'), 'none/none');
    r := r || pg_temp.chk('A3', 'the discount is the code''s own', j #>> '{discount,percent}' || '/' || (j #>> '{discount,lessons}'), '10/3');
    insert into tutor_verification_documents (tutor_id, document_type, document_url, status) values (ta, 'teaching_qualification', 'fixture/q-' || ta, 'verified') returning id into d_q;
    t := pg_temp.run_as(ad, format($q$select public.admin_record_credential(%L, 'student_teacher_enrolled', null, %L, 'private note zzsecret')::text$q$, ta, d_q));
    r := r || pg_temp.chk('A4', 'the student teacher credential is recorded the admin app''s way', case when t ~ '^ERR' then t else 'true' end, 'true');
    r := r || pg_temp.chk('A5', 'level and price unchanged (assigned level stays the floor)', (select current_sub_tier_id || '/' || coalesce(credential_floor_sub_tier_id, '-') from tutor_profiles where id = ta), '2C/2C');
    j := (pg_temp.run_as(null, format('select public.public_tutor_page(%L)::text', ccode)))::jsonb;
    r := r || pg_temp.chk('A6', 'basis is her own credential label, price unchanged, nothing private', concat_ws('/', j #>> '{basis,kind}', j #>> '{basis,label}', j ->> 'price', ((j::text not ilike '%zzsecret%') and (j -> 'basis') ?| array['tier_id', 'note'] = false)::text),
      'credential/Student teacher enrolled in a B.Ed or PGCE (proof of enrolment)/280.00/true');
    r := r || pg_temp.chk('A7', 'a credential below the tier: the tier line stays hidden', coalesce(j ->> 'tier_line', 'none'), 'none');
    j := (pg_temp.run_as(null, format('select public.public_tutor_page(%L)::text', bcode)))::jsonb;
    r := r || pg_temp.chk('A8', 'first level, nothing recorded: tier line shown, no basis', (j ->> 'tier_line' is not null)::text || '/' || coalesce(j ->> 'basis', 'none'), 'true/none');
    r := r || pg_temp.chk('A9', 'rights: visitor reads the page only; signed-in reads booking page and times; helpers closed',
      concat_ws('/', has_function_privilege('anon', 'public.public_tutor_page(text)', 'execute'), has_function_privilege('anon', 'public.tutor_booking_page(text)', 'execute'), has_function_privilege('anon', 'public.tutor_page_times(text,numeric,integer)', 'execute'),
        has_function_privilege('authenticated', 'public.tutor_booking_page(text)', 'execute'), has_function_privilege('authenticated', 'public.tutor_page_times(text,numeric,integer)', 'execute'),
        has_function_privilege('authenticated', 'public.tutor_level_basis(uuid)', 'execute'), has_function_privilege('authenticated', 'public.tutor_page_open_to(uuid,uuid)', 'execute'), has_function_privilege('authenticated', 'public.request_next_step_words(uuid)', 'execute')),
      't/f/f/t/t/f/f/f');
    -- a level reached by the tutor's own record
    update tutor_profiles set current_sub_tier_id = '1B', total_completed_hours = 12, avg_rating = 4.9 where id = tb;
    j := (pg_temp.run_as(null, format('select public.public_tutor_page(%L)::text', bcode)))::jsonb;
    r := r || pg_temp.chk('A10', 'reached by record: that level''s minimums', concat_ws('/', j #>> '{basis,kind}', j #>> '{basis,min_hours}', j #>> '{basis,outside_hours}'), 'record/10/false');
    update tutor_profiles set total_completed_hours = 2 where id = tb;
    j := (pg_temp.run_as(null, format('select public.public_tutor_page(%L)::text', bcode)))::jsonb;
    r := r || pg_temp.chk('A11', 'minimums not met: never shown', coalesce(j ->> 'basis', 'none'), 'none');
    insert into tutor_prior_hours (tutor_id, hours, reason, proof_reference, added_by) values (tb, 20, 'zz test reason for hours', 'zz test proof', ad);
    j := (pg_temp.run_as(null, format('select public.public_tutor_page(%L)::text', bcode)))::jsonb;
    r := r || pg_temp.chk('A12', 'met only with hours from outside: said so', concat_ws('/', j #>> '{basis,kind}', j #>> '{basis,outside_hours}'), 'record/true');
    update tutor_profiles set current_sub_tier_id = '1A' where id = tb;

    -- B. the booking page and its times
    j := (pg_temp.run_as(pa, format('select public.tutor_booking_page(%L)::text', ccode)))::jsonb;
    r := r || pg_temp.chk('B1', 'signed in, no code: the booking page names the tutor to address', (j ->> 'tutor_id') = ta::text || '', 'true');
    d3 := to_char((now() at time zone 'Africa/Johannesburg')::date + 3, 'YYYY-MM-DD');
    j := (pg_temp.run_as(pa, format('select public.tutor_page_times(%L, 1, 10)::text', ccode)))::jsonb;
    select x -> 'times' into k from jsonb_array_elements(j -> 'days') x where x ->> 'date' = d3;
    r := r || pg_temp.chk('B2', 'one hour: only starts inside the working hours', k::text, '["10:00", "10:30", "11:00"]');
    j := (pg_temp.run_as(pa, format('select public.tutor_page_times(%L, 2, 10)::text', ccode)))::jsonb;
    select x -> 'times' into k from jsonb_array_elements(j -> 'days') x where x ->> 'date' = d3;
    r := r || pg_temp.chk('B3', 'two hours: only the one start', k::text, '["10:00"]');
    insert into sessions (student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, scheduled_start, booked_by_profile_id, currency_code, status)
      values (ot, ta, 1, 100, 10, 100, 90, pg_temp.at_sa(3, '10:00'), ot, 'ZAR', 'scheduled');
    j := (pg_temp.run_as(pa, format('select public.tutor_page_times(%L, 1, 10)::text', ccode)))::jsonb;
    select x -> 'times' into k from jsonb_array_elements(j -> 'days') x where x ->> 'date' = d3;
    r := r || pg_temp.chk('B4', 'a booked hour is not offered', k::text, '["11:00"]');
    r := r || pg_temp.chk('B5', 'a visitor gets neither', left(pg_temp.run_as(null, format('select public.tutor_booking_page(%L)::text', ccode)), 30) || '|' || left(pg_temp.run_as(null, format('select public.tutor_page_times(%L)::text', ccode)), 30), 'ERR: permission denied for fun|ERR: permission denied for fun');

    -- C. who may address the tutor from the page
    q := pg_temp.ask(pa, ch, ta, e_ch, pg_temp.at_sa(4, '10:00'));
    r := r || pg_temp.chk('C1', 'older parent without any code, for a child: accepted', (q !~ '^ERR')::text, 'true');
    r := r || pg_temp.chk('C2', 'sent from credit and in the tutor''s queue', pg_temp.run_as(pa, format('select public.send_request_wallet(%L) ->> ''mode''', q)) || '/' || pg_temp.run_as(ta, format('select count(*)::text from public.available_requests_for_tutor() where id = %L and sent_to_you', q)), 'wallet/1');
    r := r || pg_temp.chk('C3', 'the tutor''s bell does not say "again"', (select title from notifications where profile_id = ta and type = 'request_for_you' order by created_at desc limit 1), 'A learner asked for you');
    r := r || pg_temp.chk('C4', 'no other tutor sees it', pg_temp.run_as(tb, format('select count(*)::text from public.available_requests_for_tutor() where id = %L', q)), '0');
    r := r || pg_temp.chk('C5', 'adult learner without a code, outside the hours: refused', pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(5, '15:00')), m_time);
    r := r || pg_temp.chk('C6', 'a tutor account cannot address the tutor', pg_temp.run_as(tb, format('select public.addressed_request_problem(%L, %L, %L, null, null, null)', tb, tb, ta)), substr(m_str, 6));
    update tutor_public_profile set is_public = false where tutor_id = ta;
    r := r || pg_temp.chk('C7', 'page off: refused as before', pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(5, '10:00')), m_str);
    r := r || pg_temp.chk('C8', 'page off: no booking page and no times', pg_temp.run_as(ln, format('select public.tutor_booking_page(%L)::text', ccode)) || '/' || pg_temp.run_as(ln, format('select public.tutor_page_times(%L)::text', ccode)), 'null/null');
    update tutor_public_profile set is_public = true where tutor_id = ta;
    insert into tutor_ended_pairings (tutor_id, learner_id) values (ta, ln);
    r := r || pg_temp.chk('C9', 'an ended pairing still refuses', pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(5, '10:00')), 'ERR: That tutor can''t take this request right now. You can send it to any available tutor.');
    delete from tutor_ended_pairings where tutor_id = ta and learner_id = ln;

    -- D. declined and lapsed: credit back, never told to go elsewhere
    t := pg_temp.run_as(ta, format('select public.decline_session_request(%L)::text', q));
    t := (select body from notifications where profile_id = pa and type = 'request_declined' order by created_at desc limit 1);
    r := r || pg_temp.chk('D1', 'declined: credit back, the family decides, the tutor''s page named', concat_ws('/', (t like '%is back in your credit.%')::text, (t like '%You decide what happens next: choose another time on Odette''s page, tutorlage.com/t/' || ccode || '.')::text, (t not ilike '%any available%')::text), 'true/true/true');
    r := r || pg_temp.chk('D2', 'the credit is whole again', (select available_rand::text || '/' || held_rand::text from wallets where profile_id = pa), '5000/0');
    q := pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(6, '10:00'));
    t := pg_temp.run_as(ln, format('select public.send_request_wallet(%L) ->> ''mode''', q));
    update session_requests set expires_at = now() - interval '1 minute' where id = q::uuid;
    perform set_config('request.jwt.claims', '', true);
    perform public.expire_stale_paid_requests();
    t := (select body from notifications where profile_id = ln and type = 'request_expired' order by created_at desc limit 1);
    r := r || pg_temp.chk('D3', 'lapsed: credit back, the family decides, no other tutor offered', concat_ws('/', (t like '%is back in your credit.%')::text, (t like '%choose another time on Odette''s page%')::text, (t not ilike '%any available%')::text), 'true/true/true');
    r := r || pg_temp.chk('D4', 'it stays addressed and ended', (select status || '/' || (requested_tutor_id = ta)::text from session_requests where id = q::uuid), 'expired/true');
    -- a returning learner's "book again" keeps the old words
    insert into sessions (student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id, currency_code, status)
      values (lr, ta, 1, 100, 10, 100, 90, pg_temp.at_sa(-5, '10:00'), e_lr, lr, 'ZAR', 'completed');
    q := pg_temp.ask(lr, lr, ta, e_lr, pg_temp.at_sa(7, '10:00'), false);
    t := pg_temp.run_as(lr, format('select public.send_request_wallet(%L) ->> ''mode''', q));
    r := r || pg_temp.chk('D5', 'a taught learner: the bell says "again"', case when q ~ '^ERR' or t ~ '^ERR' then q || t else (select count(*)::text from notifications where profile_id = ta and title = 'A learner asked for you again') end, '1');
    t := pg_temp.run_as(ta, format('select public.decline_session_request(%L)::text', q));
    r := r || pg_temp.chk('D6', 'book again declined: the words as before', ((select body from notifications where profile_id = lr and type = 'request_declined' order by created_at desc limit 1) like '%send the same request to any available tutor%')::text, 'true');

    -- E. the home banner of a family that came with the code
    update profiles set promo_code_id = (select id from promo_codes where code = ccode), promo_code_entered = ccode, promo_attached_at = now() where id = ln;
    j := (pg_temp.run_as(ln, 'select public.my_linked_tutor()::text'))::jsonb;
    r := r || pg_temp.chk('E1', 'linked tutor: code and capitalised name', (j ->> 'code') || '/' || (j ->> 'first_name'), ccode || '/Odette');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
