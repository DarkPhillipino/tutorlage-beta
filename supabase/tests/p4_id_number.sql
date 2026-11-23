-- Rolled-back test of migration 20261123160000_p4_id_number.sql (P4-3, 23 Nov 2026): the ID number checked, the date derived, the number never kept; the name compare. Run it TOGETHER with the
-- migration (one statement; the last line raises so everything is undone) or alone after the apply. Made-up people and made-up numbers only; nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  id1 text; id2 text; id3 text; idbad text; idfeb text; t text; n int;
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
    -- an ID number for a date, built independently of the function under test: 12 digits, then the Luhn check digit
    execute $mk$
      create function pg_temp.mkid(p_yymmdd text, p_seq text) returns text language plpgsql as $f$
      declare b text := p_yymmdd || p_seq || '08'; s int := 0; d int; i int;
      begin
        for i in 1..12 loop
          d := substr(b, 13 - i, 1)::int;
          if i % 2 = 1 then d := d * 2; if d > 9 then d := d - 9; end if; end if;
          s := s + d;
        end loop;
        return b || ((10 - s % 10) % 10)::text;
      end $f$ $mk$;
    id1 := pg_temp.mkid('900517', '5009');   -- 17 May 1990
    id2 := pg_temp.mkid('060302', '0123');   -- 2 March 2006
    id3 := pg_temp.mkid('120101', '5555');   -- 1 January 2012 (a minor)
    idbad := substr(id1, 1, 12) || ((substr(id1, 13, 1)::int + 3) % 10)::text;
    idfeb := pg_temp.mkid('900231', '5009'); -- 31 February
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'id.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'id.sup.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
      (t1, z, 'authenticated', 'authenticated', 'id.t1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Thandi', 'surname', 'Nkosi', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'id.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zoë', 'surname', 'Müller-Smit', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'id.off.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_sup, 'Sam', 'Support', 'id.sup.' || uid || '@example.invalid', '', 'support_agent', true);

    -- A. the check
    r := r || pg_temp.chk('A1', 'a valid number gives its date, adult, citizen', pg_temp.run_as(v_off, format($q$select (public.admin_check_id_number(%L)->>'ok') || '|' || (public.admin_check_id_number(%L)->>'dob') || '|' || (public.admin_check_id_number(%L)->>'adult') || '|' || (public.admin_check_id_number(%L)->>'citizenship')$q$, id1, id1, id1, id1)), 'true|1990-05-17|true|citizen');
    r := r || pg_temp.chk('A2', 'YY 06 is 2006, not 1906', pg_temp.run_as(v_off, format($q$select public.admin_check_id_number(%L)->>'dob'$q$, id2)), '2006-03-02');
    r := r || pg_temp.chk('A3', 'a minor is valid but not adult', pg_temp.run_as(v_off, format($q$select (public.admin_check_id_number(%L)->>'ok') || (public.admin_check_id_number(%L)->>'adult')$q$, id3, id3)), 'truefalse');
    r := r || pg_temp.chk('A4', 'a wrong check digit', pg_temp.run_as(v_off, format($q$select public.admin_check_id_number(%L)->>'reason'$q$, idbad)), 'bad_check_digit');
    r := r || pg_temp.chk('A5', 'twelve digits, and letters', pg_temp.run_as(v_off, format($q$select (public.admin_check_id_number(%L)->>'reason') || '|' || (public.admin_check_id_number('abc')->>'reason')$q$, substr(id1, 1, 12))), 'not_13_digits|not_13_digits');
    r := r || pg_temp.chk('A6', '31 February is not a date', pg_temp.run_as(v_off, format($q$select public.admin_check_id_number(%L)->>'reason'$q$, idfeb)), 'bad_date');
    r := r || pg_temp.chk('A7', 'spaces and hyphens are ignored', pg_temp.run_as(v_off, format($q$select public.admin_check_id_number(%L)->>'dob'$q$, substr(id1, 1, 6) || ' ' || substr(id1, 7, 4) || '-' || substr(id1, 11))), '1990-05-17');
    r := r || pg_temp.chk('A8', 'the answer never contains the number', (pg_temp.run_as(v_off, format($q$select public.admin_check_id_number(%L)::text$q$, id1)) like '%' || id1 || '%')::text, 'false');

    -- B. saving only the date
    r := r || pg_temp.chk('B1', 'a date that does not match the number is refused, and the message does not hold the number', (pg_temp.run_as(v_off, format($q$select public.admin_set_date_of_birth_from_id(%L, %L, %L::date)::text$q$, t1, id1, '1991-05-17')) like '%' || id1 || '%')::text || '|' || pg_temp.run_as(v_off, format($q$select public.admin_set_date_of_birth_from_id(%L, %L, %L::date)::text$q$, t1, id1, '1991-05-17')), 'false|ERR: The date you confirmed does not match the number: check it again');
    r := r || pg_temp.chk('B2', 'a bad number is refused with a code, not the number', pg_temp.run_as(v_off, format($q$select public.admin_set_date_of_birth_from_id(%L, %L, %L::date)::text$q$, t1, idbad, '1990-05-17')), 'ERR: The ID number is not valid (bad_check_digit): check it against the document');
    r := r || pg_temp.chk('B3', 'the confirmed date is saved and it says adult', pg_temp.run_as(v_off, format($q$select public.admin_set_date_of_birth_from_id(%L, %L, %L::date)->>'adult'$q$, t1, id1, '1990-05-17')), 'true');
    select date_of_birth::text into t from public.profiles where id = t1;
    r := r || pg_temp.chk('B4', 'the profile holds the date', t, '1990-05-17');
    select count(*)::text into n from public.admin_audit_logs a where a.target_entity_id = t1 and a.action::text = 'date_of_birth_recorded' and a.metadata ->> 'source' = 'id_number';
    r := r || pg_temp.chk('B5', 'one audit line, source id_number', n::text, '1');
    select (select count(*) from public.admin_audit_logs a where a.metadata::text like '%' || id1 || '%' or a.target_entity_id::text like '%' || id1 || '%')::text into t;
    r := r || pg_temp.chk('B6', 'the number is in no audit line', t, '0');
    select (select count(*) from public.profiles p where to_jsonb(p)::text like '%' || id1 || '%')::text into t;
    r := r || pg_temp.chk('B7', 'the number is on no profile row', t, '0');
    r := r || pg_temp.chk('B8', 'a support agent is refused', pg_temp.run_as(v_sup, format($q$select public.admin_set_date_of_birth_from_id(%L, %L, %L::date)::text$q$, t1, id1, '1990-05-17')), 'ERR: Only a verification officer or a super admin can record a date of birth');
    r := r || pg_temp.chk('B9', 'a tutor is refused', pg_temp.run_as(t2, format($q$select public.admin_check_id_number(%L)::text$q$, id1)), 'ERR: Admins only');
    r := r || pg_temp.chk('B10', 'a signed-out caller is refused', pg_temp.run_as(null, format($q$select public.admin_check_id_number(%L)::text$q$, id1)), 'ERR: permission denied for function admin_check_id_number');
    r := r || pg_temp.chk('B11', 'the manual date (passports) still works as before', pg_temp.run_as(v_off, format($q$select coalesce(public.admin_set_date_of_birth(%L, %L::date)::text, 'done')$q$, t2, '1985-02-03')), '');

    -- C. the name compare
    r := r || pg_temp.chk('C1', 'same name, other order and case', pg_temp.run_as(v_off, format($q$select public.admin_name_check(%L, 'NKOSI thandi')->>'result'$q$, t1)), 'match');
    r := r || pg_temp.chk('C2', 'a printed middle name is fine', pg_temp.run_as(v_off, format($q$select public.admin_name_check(%L, 'Thandi Sipho Nkosi')->>'result'$q$, t1)), 'match');
    r := r || pg_temp.chk('C3', 'a different surname (a marriage) is an ASK, not a refusal', pg_temp.run_as(v_off, format($q$select public.admin_name_check(%L, 'Thandi Dlamini')->>'result'$q$, t1)), 'ask');
    r := r || pg_temp.chk('C4', 'accents and hyphens are ignored', pg_temp.run_as(v_off, format($q$select public.admin_name_check(%L, 'ZOE MULLER SMIT')->>'result'$q$, t2)), 'match');
    r := r || pg_temp.chk('C5', 'nothing typed is refused with a plain sentence', pg_temp.run_as(v_off, format($q$select public.admin_name_check(%L, '  ')::text$q$, t1)), 'ERR: Type the name as it is printed on the document');
    r := r || pg_temp.chk('C6', 'a support agent is refused', pg_temp.run_as(v_sup, format($q$select public.admin_name_check(%L, 'Thandi Nkosi')::text$q$, t1)), 'ERR: Only a verification officer or a super admin can compare names');
    r := r || pg_temp.chk('C7', 'it saves nothing: the typed name is in no table', (select count(*) from public.admin_audit_logs a where a.metadata::text ilike '%Dlamini%')::text, '0');

    -- D. rights
    select string_agg(p.proname || '=' || has_function_privilege('anon', p.oid, 'execute')::int || has_function_privilege('authenticated', p.oid, 'execute')::int || has_function_privilege('service_role', p.oid, 'execute')::int, ' ' order by p.proname) into t
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_check_id_number', 'admin_set_date_of_birth_from_id', 'admin_name_check', 'name_words', 'make_date_safe');
    r := r || pg_temp.chk('D1', 'execute rights anon/signed-in/server key', t, 'admin_check_id_number=010 admin_name_check=010 admin_set_date_of_birth_from_id=010 make_date_safe=000 name_words=000');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
