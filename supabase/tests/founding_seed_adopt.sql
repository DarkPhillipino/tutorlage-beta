-- Rolled-back test of migration 20261118200000_founding_seed_adopt.sql (the CEO's account tool, "adopt" mode, 18 Nov 2026): an account made through the ordinary sign-up form for a person on the founding
-- list is adopted only when it is safe (linked, same email, never signed in, no claims), files the list row's subjects as unverified claims, fixes the capitalisation of the name only when it is clearly the
-- same words, and touches no other account. Made-up people only (example.invalid); the block ends with `raise exception` so nothing is kept.
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/founding_seed_adopt.sql supabase/migrations/20261118200000_founding_seed_adopt.sql
-- After the apply, paste this file alone.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  adult text := ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text;
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid(); ud uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); uo uuid := gen_random_uuid();
  ra uuid; rb uuid; rc uuid; rd uuid; re_ uuid; rn uuid;
  tg text := 'zzad' || substr(uid, 1, 8);
  subj constant jsonb := '[{"subject": "Mathematics", "min_grade": "Grade 8", "max_grade": "Grade 12"}, {"subject": "Geography", "min_grade": "Grade 8", "max_grade": "Grade 11"}]'::jsonb;
  j jsonb; t text; nfail int; nlines int; n_other_before int; name_other_before text;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    execute $mk$
      create function pg_temp.mkrow(p_src text, p_email text, p_full text, p_first text, p_surname text) returns uuid language plpgsql as $f$
      declare v uuid;
      begin
        insert into public.founding_tutors_list (source, full_name, first_name, surname, code_name, whatsapp, email, email_key, src, status, subjects)
        values ('form', p_full, p_first, p_surname, 'Zz', '+27820000009', p_email, lower(p_email), p_src, 'joined',
                '[{"subject": "Mathematics", "min_grade": "Grade 8", "max_grade": "Grade 12"}, {"subject": "Geography", "min_grade": "Grade 8", "max_grade": "Grade 11"}]'::jsonb)
        returning id into v;
        return v;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.mkuser(p_id uuid, p_email text, p_first text, p_surname text) returns void language sql as $f$
        insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
                jsonb_build_object('role', 'tutor', 'first_name', p_first, 'surname', p_surname), '{}')
      $f$ $mk$;

    execute $mk$
      create function pg_temp.err(p_sql text) returns text language plpgsql as $f$
      begin
        execute p_sql;
        return 'no error';
      exception when others then
        return sqlerrm;
      end $f$ $mk$;

    -- A: the Odi case (one-word list name, profile name typed in lower case with a surname); B: row with first name and surname, profile in lower case; C: different words; D: has signed in; E: no account; F: other account
    ra := pg_temp.mkrow(tg || '-a', 'ad.a.' || uid || '@example.invalid', 'Zzodirile', null, null);
    rb := pg_temp.mkrow(tg || '-b', 'ad.b.' || uid || '@example.invalid', 'Zane Zulu', 'Zane', 'Zulu');
    rc := pg_temp.mkrow(tg || '-c', 'ad.c.' || uid || '@example.invalid', 'Rob Smith', 'Rob', 'Smith');
    rd := pg_temp.mkrow(tg || '-d', 'ad.d.' || uid || '@example.invalid', 'Zzdana', null, null);
    re_ := pg_temp.mkrow(tg || '-e', 'ad.e.' || uid || '@example.invalid', 'Zzeve', null, null);   -- no account will be made for this one
    perform pg_temp.mkuser(ua, 'ad.a.' || uid || '@example.invalid', 'zzodirile', 'kgobe');
    perform pg_temp.mkuser(ub, 'ad.b.' || uid || '@example.invalid', 'zane', 'zulu');
    perform pg_temp.mkuser(uc, 'ad.c.' || uid || '@example.invalid', 'bob', 'smith');
    perform pg_temp.mkuser(ud, 'ad.d.' || uid || '@example.invalid', 'zzdana', 'dube');
    perform pg_temp.mkuser(uo, 'ad.o.' || uid || '@example.invalid', 'zzother', 'person');
    update public.founding_tutors_list set user_id = ua where id = ra and user_id is null;
    update public.founding_tutors_list set user_id = ub where id = rb and user_id is null;
    update public.founding_tutors_list set user_id = uc where id = rc and user_id is null;
    update public.founding_tutors_list set user_id = ud where id = rd and user_id is null;
    update auth.users set last_sign_in_at = now() where id = ud;
    r := r || pg_temp.chk('S0 setup', 'made-up accounts linked to their list rows by the sign-up (A, B, C, D) and one list row with no account (E); one unrelated account (O)',
      (select count(*)::text from public.founding_tutors_list f where f.id in (ra, rb, rc, rd) and f.user_id is not null) || '/' || (select count(*)::text from public.founding_tutors_list f where f.id = re_ and f.user_id is null), '4/1');
    select count(*) into n_other_before from public.tutor_subject_competencies where tutor_id = uo;
    select full_name into name_other_before from public.profiles where id = uo;

    -- dry run: reads, writes nothing
    j := public.founding_seed_adopt(tg || '-a');
    r := r || pg_temp.chk('A1', 'a dry run says it is safe (ok, no problems, never signed in, no claims, 2 subjects on the row)',
      (j ->> 'ok') || '/' || jsonb_array_length(j -> 'problems')::text || '/' || (j ->> 'never_signed_in') || '/' || (j ->> 'claims_now') || '/' || (j ->> 'row_subjects') || '/' || (j ->> 'dry'), 'true/0/true/0/2/true');
    r := r || pg_temp.chk('A2', 'the answer names the account from the row own link and the email', ((j ->> 'user_id') = ua::text)::text || '/' || (j ->> 'email'), 'true/' || 'ad.a.' || uid || '@example.invalid');
    r := r || pg_temp.chk('A3', 'a dry run wrote nothing (no claims, the row still joined)', (select count(*)::text from public.tutor_subject_competencies where tutor_id = ua) || '/' || (select status from public.founding_tutors_list where id = ra), '0/joined');
    r := r || pg_temp.chk('A4', 'the row has no surname, so the name is left as typed and the note says so', ((j ->> 'name_fix') is null)::text || '/' || ((j ->> 'name_note') like 'The list row has no surname%')::text, 'true/true');

    -- adopt A for real
    j := public.founding_seed_adopt(tg || '-a', false);
    r := r || pg_temp.chk('A5', 'adopting files the 2 claims as PENDING (unverified)', (select count(*)::text || '/' || count(*) filter (where verification_status::text = 'pending')::text from public.tutor_subject_competencies where tutor_id = ua), '2/2');
    r := r || pg_temp.chk('A6', 'the list row is signed up and released', (select status || '/' || (released_at is not null)::text || '/' || (wave is not null)::text from public.founding_tutors_list where id = ra), 'signed_up/true/true');
    r := r || pg_temp.chk('A7', 'the name was left as typed (no surname on the row)', (select full_name from public.profiles where id = ua), 'zzodirile kgobe');
    r := r || pg_temp.chk('A8', 'it wrote nothing about consent, date of birth or the account tables',
      (select count(*)::text from public.policy_acceptances where profile_id = ua) || '/' || (select (date_of_birth is null)::text from public.profiles where id = ua), '0/true');
    t := pg_temp.err(format('select public.founding_seed_adopt(%L, false)', tg || '-a'));
    r := r || pg_temp.chk('A9', 'a second adopt is refused (already filed) and files nothing more', (t like 'Not adopted: The account already has 2 subject claim(s)%')::text || '/' || (select count(*)::text from public.tutor_subject_competencies where tutor_id = ua), 'true/2');
    r := r || pg_temp.chk('A10', 'a dry run on the adopted account now lists that problem', (public.founding_seed_adopt(tg || '-a') ->> 'ok') || '/' || (public.founding_seed_adopt(tg || '-a') -> 'problems' ->> 0 like 'The account already has%')::text, 'false/true');

    -- B: first name and surname on the row are the same words as the account name apart from capitals: fixed
    j := public.founding_seed_adopt(tg || '-b');
    r := r || pg_temp.chk('B1', 'a dry run offers the capitalisation fix', (j ->> 'name_fix') || '/' || ((j ->> 'name_note') is null)::text, 'Zane Zulu/true');
    perform public.founding_seed_adopt(tg || '-b', false);
    r := r || pg_temp.chk('B2', 'adopting applies it', (select full_name from public.profiles where id = ub), 'Zane Zulu');

    -- C: not the same words: left as typed, and said so
    j := public.founding_seed_adopt(tg || '-c');
    r := r || pg_temp.chk('C1', 'different words (bob smith / Rob Smith): no fix and the note says why', ((j ->> 'name_fix') is null)::text || '/' || ((j ->> 'name_note') like '%are not the same words%')::text, 'true/true');
    perform public.founding_seed_adopt(tg || '-c', false);
    r := r || pg_temp.chk('C2', 'adopting leaves the name as typed but still files the claims', (select full_name from public.profiles where id = uc) || '/' || (select count(*)::text from public.tutor_subject_competencies where tutor_id = uc), 'bob smith/2');

    -- D: already signed in: refused, nothing changed
    j := public.founding_seed_adopt(tg || '-d');
    r := r || pg_temp.chk('D1', 'a person who has signed in: not ok, with that reason', (j ->> 'ok') || '/' || ((j -> 'problems' ->> 0) like 'This person has already signed in%')::text, 'false/true');
    t := pg_temp.err(format('select public.founding_seed_adopt(%L, false)', tg || '-d'));
    r := r || pg_temp.chk('D2', 'and a real adopt is refused and files nothing', (t like 'Not adopted: This person has already signed in%')::text || '/' || (select count(*)::text from public.tutor_subject_competencies where tutor_id = ud) || '/' || (select status from public.founding_tutors_list where id = rd), 'true/0/joined');

    -- E: no account on the row; unknown key
    j := public.founding_seed_adopt(tg || '-e');
    r := r || pg_temp.chk('E1', 'a row with no account: not ok, use the normal mode', (j ->> 'ok') || '/' || ((j -> 'problems' ->> 0) like 'No account is linked%')::text, 'false/true');
    r := r || pg_temp.chk('E2', 'an unknown tag is refused', pg_temp.err(format('select public.founding_seed_adopt(%L)', 'zz-no-such-' || uid)), 'No list row has the tag or email "zz-no-such-' || uid || '"');
    r := r || pg_temp.chk('E3', 'an empty key is refused', pg_temp.err('select public.founding_seed_adopt('''')'), 'Name the list tag or the email');

    -- email mismatch: the account linked to the row has another address
    update auth.users set email = 'ad.other.' || uid || '@example.invalid' where id = ua;
    j := public.founding_seed_adopt(tg || '-a');
    r := r || pg_temp.chk('M1', 'an account whose email differs from the row is reported (not safe)', ((j -> 'problems')::text like '%different email address%')::text, 'true');

    -- no other account was touched, and who may call it
    r := r || pg_temp.chk('X1', 'the unrelated account is exactly as it was (name and claims)', (select full_name from public.profiles where id = uo) || '/' || (select count(*)::text from public.tutor_subject_competencies where tutor_id = uo),
      name_other_before || '/' || n_other_before::text);
    r := r || pg_temp.chk('X2', 'only the server key may call it',
      has_function_privilege('anon', 'public.founding_seed_adopt(text, boolean)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.founding_seed_adopt(text, boolean)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.founding_seed_adopt(text, boolean)', 'execute')::text, 'false/false/true');
    -- the Module 7 exemption of the seeding step works on the adopted account (the row is linked)
    update auth.users set email = 'ad.a.' || uid || '@example.invalid' where id = ua;
    j := public.founding_grant_module7_exemption(tg || '-a', 30);
    r := r || pg_temp.chk('X3', 'the exemption function reaches the adopted account through its row', (j ->> 'days') || '/' || (select count(*)::text from public.module7_exemptions e where e.tutor_id = ua), '30/1');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
