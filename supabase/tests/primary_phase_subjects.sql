-- Rolled-back test of migration 20261109100000_primary_phase_subjects.sql (Grade R to 9 subjects, 9 Nov 2026). See README.md.
-- RUN IT TOGETHER WITH THE MIGRATION in one statement (scripts/run-rolled-back-test.mjs <out.sql> <this file> <the migration>): before the
-- apply it proves the migration works; AFTER the apply the migration runs a second time inside the block, so a clean report also proves
-- that a re-run changes nothing. It can also run on its own after the apply. Every line ends "ok" or carries FAIL.
-- Fixtures are two throwaway tutors, a parent and a child, and two throwaway schools; the real subject names are used on purpose
-- (nothing else on production holds a competency in any of the six new subjects, so no real tutor can change an answer).
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '8 years')::date::text;
  v_f uuid := gen_random_uuid();   -- a Foundation Phase tutor: Life Skills and English Home Language, Grade R to Grade 3, approved
  v_i uuid := gen_random_uuid();   -- an Intermediate Phase tutor: the Grade 4 to 7 subjects, approved (Economic and Management Sciences still pending)
  v_p uuid := gen_random_uuid();   -- a parent
  v_c uuid := gen_random_uuid();   -- the parent's child, Grade 3
  c_pcaps uuid; c_caps uuid; s_prim uuid; s_caps uuid;
  newnames text[] := array['Economic and Management Sciences', 'Life Skills', 'Natural Sciences', 'Natural Sciences and Technology', 'Social Sciences', 'Technology'];
  originals text[] := array[
    'Accounting', 'Afrikaans First Additional Language', 'Afrikaans Home Language', 'Agricultural Management Practices', 'Agricultural Sciences',
    'Agricultural Technology', 'Business Studies', 'Civil Technology', 'Computer Applications Technology', 'Consumer Studies', 'Dance Studies',
    'Design', 'Dramatic Arts', 'Economics', 'Electrical Technology', 'Engineering Graphics and Design', 'English First Additional Language',
    'English Home Language', 'French First Additional Language', 'Geography', 'German First Additional Language', 'History',
    'Hospitality Studies', 'Information Technology', 'isiNdebele First Additional Language', 'isiNdebele Home Language',
    'isiXhosa First Additional Language', 'isiXhosa Home Language', 'isiZulu First Additional Language', 'isiZulu Home Language',
    'Life Orientation', 'Life Sciences', 'Mandarin First Additional Language', 'Marine Sciences', 'Mathematical Literacy', 'Mathematics',
    'Mechanical Technology', 'Music', 'Physical Sciences', 'Portuguese First Additional Language', 'Religion Studies',
    'Sepedi First Additional Language', 'Sepedi Home Language', 'Sesotho First Additional Language', 'Sesotho Home Language',
    'Setswana First Additional Language', 'Setswana Home Language', 'siSwati First Additional Language', 'siSwati Home Language',
    'South African Sign Language Home Language', 'Spanish First Additional Language', 'Technical Mathematics', 'Technical Sciences', 'Tourism',
    'Tshivenda First Additional Language', 'Tshivenda Home Language', 'Visual Arts', 'Xitsonga First Additional Language', 'Xitsonga Home Language'];
  n int; m int; t text;
  nfail int; nlines int; rep text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them
  -- ---- the list itself ----------------------------------------------------------------------------------------------------
  select count(*) into n from public.subjects where name = any(newnames);
  r := r || format('P1 the six new names are each there once: %s', case when n = 6 then 'ok' else 'FAIL found ' || n || ' of 6' end) || E'\n';
  select count(*) - count(distinct lower(btrim(name))) into n from public.subjects;
  r := r || format('P2 no two subjects differ only by capitals or end spaces: %s', case when n = 0 then 'ok' else 'FAIL ' || n || ' duplicates' end) || E'\n';
  select count(*) into n from public.subjects where name = any(originals);
  r := r || format('P3 all 59 older subjects are still there, same spelling: %s', case when n = array_length(originals, 1) then 'ok' else 'FAIL ' || n || ' of ' || array_length(originals, 1) end) || E'\n';
  select count(*) into n from public.subjects;
  r := r || format('P4 total subjects (info only, 65 = 59 + 6 on 9 Nov, more if someone added one since): %s', n) || E'\n';
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'subjects';
  select count(*) into m from pg_constraint where contype = 'f' and confrelid = 'public.subjects'::regclass;
  r := r || format('P5 the table is still id, name, created_at and nothing points at it: %s', case when n = 3 and m = 0 then 'ok' else 'FAIL columns=' || n || ' foreign keys=' || m end) || E'\n';
  select count(*) into n from public.tier1_subjects where subject_name = any(newnames);
  select count(*) into m from public.tier1_subjects;
  r := r || format('P6 the Tier 1 list is unchanged (12 subjects, none of the six): %s', case when n = 0 and m = 12 then 'ok' else 'FAIL new=' || n || ' total=' || m end) || E'\n';
  select count(*) into n from public.grade_levels where name in ('Grade R', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9');
  r := r || format('P7 the grade list already holds Grade R to Grade 9: %s', case when n = 10 then 'ok' else 'FAIL ' || n || ' of 10' end) || E'\n';
  set local role anon;
  select count(*) into n from public.subjects where name = any(newnames);
  reset role;
  r := r || format('P8 a signed-out visitor (the search box) can read the new names: %s', case when n = 6 then 'ok' else 'FAIL sees ' || n || ' of 6' end) || E'\n';

  -- ---- fixtures -----------------------------------------------------------------------------------------------------------
  select id into c_caps from public.curricula where code = 'CAPS';
  select id into c_pcaps from public.curricula where code = 'PRIMARY_CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_f, z,'authenticated','authenticated','ps.f.'||v_f||'@example.invalid', jsonb_build_object('role','tutor','first_name','Foundation','date_of_birth',adult), '{}'),
    (v_i, z,'authenticated','authenticated','ps.i.'||v_i||'@example.invalid', jsonb_build_object('role','tutor','first_name','Intermediate','date_of_birth',adult), '{}'),
    (v_p, z,'authenticated','authenticated','ps.p.'||v_p||'@example.invalid', jsonb_build_object('role','parent','first_name','Pat','date_of_birth',adult,'phone_number','081 234 5678'), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_c, z,'authenticated','authenticated','ps.c.'||v_c||'@example.invalid', jsonb_build_object('role','student','first_name','Chi','date_of_birth',minor,'grade_level','Grade 3'),
       jsonb_build_object('created_by_guardian', v_p, 'relationship','mother'));
  update public.student_profiles set grade_level = 'Grade 3' where id = v_c;   -- as in parent_sets_learner_grade.sql: the server sets the grade after the account exists
  update public.profiles set date_of_birth = adult::date where id in (v_f, v_i);
  update public.tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id in (v_f, v_i);
  insert into public.schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test primary school', 'primary_caps', c_pcaps) returning id into s_prim;
  insert into public.schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test CAPS school', 'caps', c_caps) returning id into s_caps;
  insert into public.tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
    (v_f, 'Life Skills',                      'caps', 'Grade R', 'Grade 3', 'verified'),
    (v_f, 'English Home Language',            'caps', 'Grade R', 'Grade 3', 'verified'),
    (v_i, 'Natural Sciences and Technology',  'caps', 'Grade 4', 'Grade 6', 'verified'),
    (v_i, 'Natural Sciences',                 'caps', 'Grade 7', 'Grade 7', 'verified'),
    (v_i, 'Technology',                       'caps', 'Grade 7', 'Grade 7', 'verified'),
    (v_i, 'Social Sciences',                  'caps', 'Grade 4', 'Grade 7', 'verified'),
    (v_i, 'Mathematics',                      'caps', 'Grade 4', 'Grade 7', 'verified'),
    (v_i, 'Economic and Management Sciences', 'caps', 'Grade 7', 'Grade 7', 'pending');
  select count(*) into n from public.tutor_subject_competencies where tutor_id in (v_f, v_i);
  r := r || format('F0 setup: two tutors, %s subject rows: %s', n, case when n = 8 then 'ok' else 'FAIL want 8' end) || E'\n';

  -- ---- the tutor rule: tutor_qualify_problem returns null when the tutor can take it, else the reason -------------------------
  -- (the same function decides booking, the price levels and accepting a request; a tutor who types "Natural Sciences" is matched by
  --  name, and a longer name that contains the words also matches, which is how the rule has always worked)
  t := public.tutor_qualify_problem(v_f, 'Life Skills', 'Grade 2', null, null);
  r := r || format('Q1 Foundation tutor, Life Skills, Grade 2 can be booked: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_f, 'Life Skills', 'Grade R', null, null);
  r := r || format('Q2 and Grade R, the first grade in the list: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_f, 'Life Skills', 'Grade 5', null, null);
  r := r || format('Q3 but not Grade 5 (her approval stops at Grade 3): %s', case when t = 'wrong_grade' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  t := public.tutor_qualify_problem(v_f, 'English Home Language', 'Grade 1', null, null);
  r := r || format('Q4 English Home Language, Grade 1 (the reading and phonics route): %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Life Skills', 'Grade 2', null, null);
  r := r || format('Q5 the Intermediate tutor does not teach Life Skills: %s', case when t = 'no_subject' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Natural Sciences and Technology', 'Grade 5', null, null);
  r := r || format('Q6 Natural Sciences and Technology, Grade 5: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Natural Sciences and Technology', 'Grade 7', null, null);
  r := r || format('Q7 Natural Sciences and Technology is a Grade 4 to 6 subject, so Grade 7 is refused: %s', case when t = 'wrong_grade' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Natural Sciences', 'Grade 7', null, null);
  r := r || format('Q8 Natural Sciences, Grade 7: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Natural Sciences', 'Grade 8', null, null);
  r := r || format('Q9 Natural Sciences, Grade 8 (approved for Grade 7 only): %s', case when t = 'wrong_grade' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Natural Sciences', 'Grade 5', null, null);
  r := r || format('Q10 a Grade 5 parent who types Natural Sciences reaches the Grade 4 to 6 tutor: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Social Sciences', 'Grade 6', null, null);
  r := r || format('Q11 Social Sciences, Grade 6: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Social Sciences', 'Grade 9', null, null);
  r := r || format('Q12 Social Sciences, Grade 9 (approved to Grade 7): %s', case when t = 'wrong_grade' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Economic and Management Sciences', 'Grade 7', null, null);
  r := r || format('Q13 a subject still waiting for approval cannot be booked: %s', case when t = 'not_approved' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Technology', 'Grade 7', null, null);
  r := r || format('Q14 Technology, Grade 7: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Mathematics', 'Grade 4', null, null);
  r := r || format('Q15 Mathematics, Grade 4 (the older subject works for the lower grades): %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Mathematics', 'Grade 8', null, null);
  r := r || format('Q16 and is refused above the approved range: %s', case when t = 'wrong_grade' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Social Sciences', 'Grade 5', s_prim, null);
  r := r || format('Q17 a learner at a primary school (Primary CAPS) reaches a tutor approved under CAPS: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';
  t := public.tutor_qualify_problem(v_i, 'Social Sciences', 'Grade 5', s_caps, null);
  r := r || format('Q18 and so does a learner at a CAPS school: %s', case when t is null then 'ok' else 'FAIL ' || t end) || E'\n';

  -- ---- the learner side: a parent adds a young learner, the learner searches ---------------------------------------------------
  select grade_level into t from public.student_profiles where id = v_c;
  r := r || format('L1 a parent-made child starts in Grade 3: %s', case when t = 'Grade 3' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
    set local role authenticated;
    t := public.set_learner_grade(v_c, 'grade r');
    reset role;
    r := r || format('L2 the parent moves the child to Grade R (any capitals): %s', case when t = 'Grade R' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  exception when others then
    reset role;
    r := r || format('L2 FAIL: %s', sqlerrm) || E'\n';
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
    set local role authenticated;
    t := public.set_learner_grade(v_c, 'Grade 7');
    reset role;
    r := r || format('L3 and to Grade 7: %s', case when t = 'Grade 7' then 'ok' else 'FAIL ' || coalesce(t, 'null') end) || E'\n';
  exception when others then
    reset role;
    r := r || format('L3 FAIL: %s', sqlerrm) || E'\n';
  end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role','authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.available_price_levels('Life Skills', 'Grade 2', null);
    select count(*) into m from public.available_price_levels('Life Skills', 'Grade 8', null);
    reset role;
    r := r || format('L4 the price levels for Life Skills show a level at Grade 2 and none at Grade 8: %s',
      case when n >= 1 and m = 0 then 'ok' else 'FAIL grade2=' || n || ' grade8=' || m end) || E'\n';
  exception when others then
    reset role;
    r := r || format('L4 FAIL: %s', sqlerrm) || E'\n';
  end;

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool cuts the middle of a long error, so each report line is shortened to its id and its value (the part after the
  -- first ": "; a FAIL or STOPPED line stays whole) and the whole report fits in one error. The FAIL count counts whole lines.
  select count(*) filter (where l like '%FAIL%' or l like 'STOPPED%'), count(*) filter (where l <> '')
    into nfail, nlines from regexp_split_to_table(r, E'\n') as l;
  select string_agg(case when l like '%FAIL%' or l like 'STOPPED%' then l else regexp_replace(l, '^(\S+) [^:]*: ', E'\\1 ') end, E'\n' order by o)
    into rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  -- Inside scripts/run-rolled-back-test.mjs the report is handed back through a setting and the runner raises it (the rollback). Run on
  -- its own, the test raises it itself, so it never leaves its fixtures behind.
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'GRADE R TO 9 SUBJECTS TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'GRADE R TO 9 SUBJECTS TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
