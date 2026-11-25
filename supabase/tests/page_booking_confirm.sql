-- ROLLED BACK ONLY. Test of migration 20261125180000_page_booking_confirm.sql (PM line 81 C). On production: begin; <migration if not yet applied> <this file> rollback;
-- The last line raises so everything is undone. Never run bare on production. Made-up people only. Every line ends "ok" or "FAIL".
do $$
declare
  r text := ''; z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '40 years')::date::text; minor text := (current_date - interval '12 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); ch uuid := gen_random_uuid(); ln uuid := gen_random_uuid(); po uuid := gen_random_uuid(); np uuid := gen_random_uuid(); ch2 uuid := gen_random_uuid();
  e_ch uuid; e_ch2 uuid; e_ln uuid; e_po uuid; e_bad uuid; e_low uuid; ccode text; bcode text; t text; j jsonb; s uuid; d3 timestamptz; v_ref text := 'zzconf_' || replace(gen_random_uuid()::text, '-', ''); v_soon timestamptz;
begin
  create function pg_temp.chk(p_label text, p_got text, p_want text) returns text language sql as $f$
    select p_label || ': ' || case when p_got is not distinct from p_want then 'ok' else 'FAIL got ' || coalesce(p_got, 'null') || ' (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$;
  create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      if p_u is null then perform set_config('request.jwt.claims', '', true); set local role anon;
      else perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated; end if;
      begin execute p_sql into v; reset role; return coalesce(v, 'null');
      exception when others then reset role; return 'ERR: ' || sqlerrm; end;
    end $f$;
  create function pg_temp.book(p_payer uuid, p_learner uuid, p_tutor uuid, p_enr uuid, p_start timestamptz, p_rand integer, p_level text default '2C', p_ref text default null) returns text language plpgsql as $f$
    begin
      return pg_temp.run_as(p_payer, format('select public.confirm_page_booking(%L, %L, %L, %L, %L, 1, %L, %s)::text', p_learner, p_enr, p_tutor, p_level, p_start,
        coalesce(p_ref, 'zzconf_' || replace(gen_random_uuid()::text, '-', '')), p_rand));
    end $f$;
  create function pg_temp.at_sa(p_days int, p_time text) returns timestamptz language sql as $f$
    select (((now() at time zone 'Africa/Johannesburg')::date + p_days) + p_time::time) at time zone 'Africa/Johannesburg' $f$;
  create function pg_temp.state(p_payer uuid) returns text language sql as $f$
    select coalesce((select available_rand || '/' || held_rand from public.wallets where profile_id = p_payer), '0/0') || ' req ' || (select count(*) from public.session_requests where requested_by_profile_id = p_payer)
        || ' les ' || (select count(*) from public.sessions where booked_by_profile_id = p_payer and status = 'scheduled') $f$;

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  select x.id, z, 'authenticated', 'authenticated', 'conf.' || x.id || '@example.invalid', jsonb_build_object('role', x.role, 'first_name', x.first, 'date_of_birth', adult, 'phone_number', x.phone), '{}'
    from (values (ta, 'tutor', 'Odette', '081 234 5678'), (tb, 'tutor', 'Bo', '081 234 5678'), (pa, 'parent', 'Pat', '081 234 5678'), (ln, 'student', 'Nia', '081 234 5678'), (po, 'student', 'Otto', '081 234 5678'), (np, 'parent', 'Noa', '')) as x(id, role, first, phone);
  update profiles set date_of_birth = adult::date where id in (ta, tb, pa, ln, po, np);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (ch, z, 'authenticated', 'authenticated', 'conf.c.' || ch || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cy', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', pa, 'relationship', 'mother')),
    (ch2, z, 'authenticated', 'authenticated', 'conf.d.' || ch2 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Di', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', np, 'relationship', 'mother'));
  update parent_profiles set phone_number = '' where id = np;
  update profiles set created_at = now() - interval '60 days', promo_code_id = null where id in (pa, ln, po, np);
  update tutor_profiles set is_verified = true, current_tier_id = 2, current_sub_tier_id = '2C', credential_floor_sub_tier_id = null, institution_id = null where id in (ta, tb);
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select x, 'police_clearance', 'fixture/p-' || x, 'verified', (now() - interval '8 months')::date from unnest(array[ta, tb]) x;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    select x, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified' from unnest(array[ta, tb]) x;
  -- all day, except the weekday five days from now (10:00 to 12:00 only)
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
    select x, d, case when d = extract(dow from (now() at time zone 'Africa/Johannesburg')::date + 5) then '10:00'::time else '00:00'::time end,
                 case when d = extract(dow from (now() at time zone 'Africa/Johannesburg')::date + 5) then '12:00'::time else '23:30'::time end
    from generate_series(0, 6) d, unnest(array[ta, tb]) x;
  insert into tutor_public_profile (tutor_id, is_public) select x, true from unnest(array[ta, tb]) x on conflict (tutor_id) do update set is_public = true, withdrawn_at = null;
  insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
    select 'ZZCF' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb]) x where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
  update promo_codes set active = true, valid_from = now() - interval '1 day', valid_until = null, max_families = null where owner_tutor_id in (ta, tb);
  select code into ccode from promo_codes where owner_tutor_id = ta limit 1;
  select code into bcode from promo_codes where owner_tutor_id = tb limit 1;
  delete from policy_acceptances where profile_id in (ta, tb);
  insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, method)
    select x.p, x.p, 'terms', x.v, (select method from policy_acceptances limit 1) from (values (ta, '2026-11-25b'), (tb, '2026-11-25')) x(p, v);
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ch, 'Zorology', 'Grade 10') returning id into e_ch;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ch2, 'Zorology', 'Grade 10') returning id into e_ch2;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ln, 'Zorology', 'Grade 10') returning id into e_ln;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (po, 'Zorology', 'Grade 10') returning id into e_po;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ch, 'Quillistics', 'Grade 10') returning id into e_bad;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ch, 'Zorology', 'Grade 5') returning id into e_low;
  perform public.wallet_post(x.p, 'topup', x.a, 0, 'conf-top:' || x.p, null, 'test top-up') from (values (pa, 5000), (ln, 5000), (po, 100), (np, 5000)) x(p, a);
  d3 := pg_temp.at_sa(3, '10:00');

  r := r || pg_temp.chk('1 accepted the new Terms books on confirm; the other not', public.tutor_books_on_confirm(ta)::text || '/' || public.tutor_books_on_confirm(tb)::text, 'true/false');
  r := r || pg_temp.chk('2 the page says how it works', concat_ws('/', public.public_tutor_page(ccode) ->> 'books_on_confirm', public.public_tutor_page(bcode) ->> 'books_on_confirm'), 'true/false');
  r := r || pg_temp.chk('3 the tutor''s own screens', pg_temp.run_as(ta, 'select public.my_page_books_on_confirm()::text') || '/' || pg_temp.run_as(tb, 'select public.my_page_books_on_confirm()::text'), 'true/false');
  j := (pg_temp.run_as(pa, format('select public.tutor_page_times(%L, 1, 4)::text', ccode)))::jsonb;
  r := r || pg_temp.chk('4 open times start 24 hours ahead, no "as soon as possible"', (j ->> 'now_ok') || '/' || (select bool_and((((d ->> 'date')::date + (tm)::time) at time zone 'Africa/Johannesburg') >= now() + interval '24 hours')::text from jsonb_array_elements(j -> 'days') d, jsonb_array_elements_text(d -> 'times') tm), 'false/true');
  j := (pg_temp.run_as(pa, format('select public.tutor_page_times(%L, 1, 4)::text', bcode)))::jsonb;
  r := r || pg_temp.chk('5 the other tutor''s times are as before', (select bool_or((((d ->> 'date')::date + (tm)::time) at time zone 'Africa/Johannesburg') < now() + interval '24 hours')::text from jsonb_array_elements(j -> 'days') d, jsonb_array_elements_text(d -> 'times') tm), 'true');

  v_soon := date_bin('30 minutes', now() + interval '23 hours', '2000-01-01');
  t := pg_temp.book(pa, ch, ta, e_ch, v_soon, 280);
  r := r || pg_temp.chk('6 under 24 hours: refused, nothing kept', (t like '%at least 24 hours%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(pa, ch, ta, e_ch, pg_temp.at_sa(5, '15:00'), 280);
  r := r || pg_temp.chk('7 outside the hours: refused', (t like '%available at that time%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(pa, ch, ta, e_bad, d3, 280);
  r := r || pg_temp.chk('8 wrong subject: refused', (t like 'ERR:%subject%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(pa, ch, ta, e_low, d3, 280);
  r := r || pg_temp.chk('9 wrong grade: refused', (t like 'ERR:%grade%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(pa, ch, ta, e_ch, d3, 50, '1A');
  r := r || pg_temp.chk('10 a cheaper price level: refused', (t like '%changed%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(pa, ch, ta, e_ch, d3, 252);
  r := r || pg_temp.chk('11 a price other than the one shown: refused, nothing held', (t like '%price has changed%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(po, po, ta, e_po, d3, 280);
  r := r || pg_temp.chk('12 short credit: refused, nothing held or reserved', (t like 'ERR: Your credit has R100.%')::text || ' ' || pg_temp.state(po), 'true 100/0 req 0 les 0');
  t := pg_temp.book(ch, ch, ta, e_ch, d3, 280);
  r := r || pg_temp.chk('13 a learner under 18 cannot book', (t like 'ERR:%')::text || ' ' || pg_temp.state(ch), 'true 0/0 req 0 les 0');
  t := pg_temp.book(ln, ch, ta, e_ch, d3, 280);
  r := r || pg_temp.chk('14 nobody books another family''s child', (t like 'ERR:%')::text || ' ' || pg_temp.state(ln), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(np, ch2, ta, e_ch2, d3, 280);
  r := r || pg_temp.chk('15 a guardian without a phone number: refused', (t like '%phone number%')::text || ' ' || pg_temp.state(np), 'true 5000/0 req 0 les 0');
  insert into learner_tutor_choices (learner_id, tutor_id, choice) values (ln, ta, 'avoid');
  t := pg_temp.book(ln, ln, ta, e_ln, d3, 280);
  r := r || pg_temp.chk('16 "try someone else" still holds', (t like '%try someone else%')::text || ' ' || pg_temp.state(ln), 'true 5000/0 req 0 les 0');
  delete from learner_tutor_choices where learner_id = ln;

  t := pg_temp.book(pa, ch, ta, e_ch, d3, 280, '2C', v_ref);
  j := case when t like 'ERR%' then null else t::jsonb end; s := (j ->> 'session_id')::uuid;
  r := r || pg_temp.chk('17 booked on confirm', coalesce(j ->> 'booked', t) || ' ' || pg_temp.state(pa), 'true 4720/0 req 1 les 1');
  r := r || pg_temp.chk('18 the lesson and the money as an acceptance makes them', (select concat_ws('/', x.status, x.tutor_id = ta, x.gross_amount::int, x.tutor_payout_amount::int = 280 - round(280 * x.platform_commission_pct / 100), x.wallet_paid, q.status, q.payment_status, q.resulting_session_id = x.id) from sessions x join session_requests q on q.resulting_session_id = x.id where x.id = s), 'scheduled/t/280/t/t/accepted/wallet_paid/t');
  r := r || pg_temp.chk('19 the tutor''s bell: booked, learner, subject, time; no "please accept"', (select count(*) || '/' || count(*) filter (where type = 'session_booked' and title = 'A lesson was booked from your page' and body like 'Booked: Cy (Zorology), %10:00 SAST. You do not need to accept it.%') from notifications where profile_id = ta and type <> 'public_page_live'), '1/1'); -- verifying the made-up tutor sends its own "page is live" bell
  r := r || pg_temp.chk('20 the family''s bell', (select count(*) || '/' || count(*) filter (where title = 'Your lesson is booked' and body like 'Your lesson with Odette (Zorology), %10:00 SAST, is booked. R280 was taken from your credit.%') from notifications where profile_id = pa and type = 'request_accepted'), '1/1');
  t := pg_temp.book(pa, ch, ta, e_ch, d3, 280, '2C', v_ref);
  r := r || pg_temp.chk('21 a second tap books and charges nothing more', coalesce((case when t like 'ERR%' then null else t::jsonb end) ->> 'already', t) || ' ' || pg_temp.state(pa), 'true 4720/0 req 1 les 1');
  t := pg_temp.book(ln, ln, ta, e_ln, d3, 280);
  r := r || pg_temp.chk('22 the same time for a second family: refused, not charged', (t like '%available at that time%')::text || ' ' || pg_temp.state(ln), 'true 5000/0 req 0 les 0');
  t := pg_temp.book(ln, ln, ta, e_ln, pg_temp.at_sa(3, '10:30'), 280);
  r := r || pg_temp.chk('23 an overlapping time too', (t like '%available at that time%')::text || ' ' || pg_temp.state(ln), 'true 5000/0 req 0 les 0');
  update profiles set promo_code_id = (select id from promo_codes where owner_tutor_id = ta limit 1), created_at = now() where id = ln;
  t := pg_temp.book(ln, ln, ta, e_ln, pg_temp.at_sa(3, '14:00'), 252);
  r := r || pg_temp.chk('24 a code family pays the discounted price; the tutor''s pay is unchanged', coalesce((case when t like 'ERR%' then null else t::jsonb end) ->> 'paid_rand', t) || ' ' || pg_temp.state(ln) || ' ' || (select (count(distinct tutor_payout_amount))::text from sessions where tutor_id = ta), '252 4748/0 req 1 les 1 1');
  t := pg_temp.run_as(pa, format('select public.cancel_session(%L, null)::text', s));
  r := r || pg_temp.chk('25 the family cancels as today: credit back', (t not like 'ERR%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 1 les 0');
  select id into s from sessions where booked_by_profile_id = ln and status = 'scheduled';
  t := pg_temp.run_as(ta, format('select public.cancel_session(%L, null)::text', s));
  r := r || pg_temp.chk('26 the tutor cancels: credit back', (t not like 'ERR%')::text || ' ' || pg_temp.state(ln), 'true 5000/0 req 1 les 0');
  t := pg_temp.book(pa, ch, tb, e_ch, d3, 280);
  r := r || pg_temp.chk('27 a tutor who has not accepted the new Terms is not booked on confirm', (t like '%cannot be booked from this page%')::text || ' ' || pg_temp.state(pa), 'true 5000/0 req 1 les 0');
  t := pg_temp.run_as(pa, format('insert into public.session_requests (student_id, requested_by_profile_id, requested_tutor_id, enrollment_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, via_tutor_page) values (%L, %L, %L, %L, %L, 1, %L, ''2C'', true) returning id::text', ch, pa, tb, e_ch, d3, 'zzold_' || replace(gen_random_uuid()::text, '-', '')));
  j := (pg_temp.run_as(pa, format('select public.send_request_wallet(%L)::text', t)))::jsonb;
  r := r || pg_temp.chk('28 and still takes requests as before: held, waiting, the "asked for you" bell', (j ->> 'held_rand') || '/' || (select status || '/' || payment_status || '/' || (tutor_id is null) from session_requests where id = t::uuid) || '/' || (select count(*)::text from notifications where profile_id = tb and type = 'request_for_you'), '280/pending/card_verified/true/1');
  r := r || pg_temp.chk('29 the finishing step cannot be called on its own', (pg_temp.run_as(pa, format('select public.finish_page_booking(%L, 280)::text', t)) = 'ERR: Not allowed')::text, 'true');
  update tutor_public_profile set is_public = false where tutor_id = ta;
  t := pg_temp.book(pa, ch, ta, e_ch, d3, 280);
  r := r || pg_temp.chk('30 page switched off: refused', (t like 'ERR:%')::text, 'true');
  update tutor_public_profile set is_public = true where tutor_id = ta;
  update tutor_profiles set is_verified = false where id = ta;
  t := pg_temp.book(pa, ch, ta, e_ch, d3, 280);
  r := r || pg_temp.chk('31 a tutor who is not verified: refused', (t like 'ERR:%')::text, 'true');
  r := r || pg_temp.chk('32 rights', concat_ws('/', has_function_privilege('anon', 'public.confirm_page_booking(uuid,uuid,uuid,text,timestamptz,numeric,text,integer)', 'execute'), has_function_privilege('anon', 'public.finish_page_booking(uuid,integer)', 'execute'),
      has_function_privilege('anon', 'public.my_page_books_on_confirm()', 'execute'), has_function_privilege('authenticated', 'public.tutor_books_on_confirm(uuid)', 'execute'), has_function_privilege('authenticated', 'public.claim_session_request(uuid,uuid)', 'execute')), 'f/f/f/f/f');
  raise exception E'REPORT page_booking_confirm\n%', r;
end $$;
