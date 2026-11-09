-- Rolled-back test of migration 20261105120000_platform_suggestions.sql (the Suggestions box and the top-up pilot notice, 5 Nov 2026).
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/platform_suggestions.sql supabase/migrations/20261105120000_platform_suggestions.sql
-- or, once the migration is applied, paste this file alone. Fixtures are made-up people (example.invalid), all inserted as the owner. Every line ends
-- "ok" or "FAIL (want ...)"; the block raises an error at the end on purpose so nothing is kept. The answer is short: how many lines and how many FAIL,
-- every FAIL line in full, then the ids of the lines that passed (the Supabase tool cuts the middle of a long answer).
-- Not proved here: two sends at the very same instant (the advisory lock needs two connections); Q1 reads the function text for the lock instead.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_l  uuid := gen_random_uuid();    -- a learner (adult)
  v_t  uuid := gen_random_uuid();    -- a tutor
  v_o  uuid := gen_random_uuid();    -- another learner, whose account is closed in group C
  v_sa uuid := gen_random_uuid();    -- super_admin
  v_su uuid := gen_random_uuid();    -- support_agent
  v_fm uuid := gen_random_uuid();    -- finance_manager
  v_of uuid := gen_random_uuid();    -- a support agent whose access is switched off
  v_big text := repeat('a', 1000);
  v_sid uuid; v_before text; v_after text; v_total int; v_has_guard boolean;
  t text; t2 text; nfail int; nok int; nlines int;
begin
  begin
  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  -- the start of an answer: the whole prefix when the answer starts with it, else the answer itself (so a wrong reason stays visible)
  execute $mk$
    create function pg_temp.pfx(p_got text, p_prefix text) returns text language sql as $f$
      select case when p_got like p_prefix || '%' then p_prefix else p_got end
    $f$ $mk$;
  -- run a query as a person (null = signed out) and return its one answer, or ERR: and the database's own words
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
  -- run a statement that returns nothing (an insert, an update) as a person: 'done' or ERR:
  execute $mk$
    create function pg_temp.do_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    begin
      if p_u is null then
        perform set_config('request.jwt.claims', '', true);
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      begin
        execute p_sql;
        reset role;
        return 'done';
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  -- the server's key
  execute $mk$
    create function pg_temp.as_service(p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      set local role service_role;
      begin
        execute p_sql into v;
        reset role;
        return coalesce(v, 'null');
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  -- "refused for lack of a right"
  execute $mk$
    create function pg_temp.deny(p_got text) returns text language sql as $f$ select pg_temp.pfx(p_got, 'ERR: permission denied for') $f$ $mk$;
  -- a send by a person: user_id is their own, body as given
  execute $mk$
    create function pg_temp.send(p_u uuid, p_body text) returns text language sql as $f$
      select pg_temp.do_as(p_u, format('insert into public.platform_suggestions (user_id, body) values (%L, %L)', p_u, p_body))
    $f$ $mk$;
  -- an admin's call of the one write function: the status it answers, or ERR:
  execute $mk$
    create function pg_temp.handle(p_u uuid, p_id uuid, p_status text, p_note text) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select public.admin_handle_suggestion(%L, %L, %L)->>''status''', p_id, p_status, p_note))
    $f$ $mk$;

  -- ---- people ---------------------------------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l,  z, 'authenticated', 'authenticated', 'ps.l.'  || v_l  || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (v_t,  z, 'authenticated', 'authenticated', 'ps.t.'  || v_t  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'surname', 'Tutor', 'date_of_birth', adult), '{}'),
    (v_o,  z, 'authenticated', 'authenticated', 'ps.o.'  || v_o  || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Otto', 'surname', 'Other', 'date_of_birth', adult), '{}'),
    (v_sa, z, 'authenticated', 'authenticated', 'ps.sa.' || v_sa || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'ps.su.' || v_su || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_fm, z, 'authenticated', 'authenticated', 'ps.fm.' || v_fm || '@example.invalid', jsonb_build_object('first_name', 'Fin', 'surname', 'Manager', 'date_of_birth', adult), '{}'),
    (v_of, z, 'authenticated', 'authenticated', 'ps.of.' || v_of || '@example.invalid', jsonb_build_object('first_name', 'Olly', 'surname', 'Off', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_sa, 'Sue', 'Super', 'ps.sa.' || v_sa || '@example.invalid', '', 'super_admin', true),
    (v_su, 'Sam', 'Support', 'ps.su.' || v_su || '@example.invalid', '', 'support_agent', true),
    (v_fm, 'Fin', 'Manager', 'ps.fm.' || v_fm || '@example.invalid', '', 'finance_manager', true),
    (v_of, 'Olly', 'Off', 'ps.of.' || v_of || '@example.invalid', '', 'support_agent', false);
  r := r || 'S0 setup: a learner, a tutor, a second learner, a super admin, a support agent, a finance manager, a switched-off support agent' || E'\n';

  -- ---- W: adding a suggestion -------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('W1', 'a learner adds their own suggestion', pg_temp.send(v_l, E'  Please add Afrikaans lessons\n'), 'done');
  select (role || '|' || status || '|' || coalesce(admin_note, '-') || '|' || coalesce(handled_at::text, '-') || '|' || coalesce(handled_by::text, '-') || '|' || body) into t
    from platform_suggestions where user_id = v_l;
  r := r || pg_temp.chk('W2', 'the database filled role from the profile, set status new, no note, not handled, and trimmed the text', t, 'student|new|-|-|-|Please add Afrikaans lessons');
  r := r || pg_temp.chk('W3', 'a tutor adds one', pg_temp.send(v_t, 'A way to message my learners'), 'done');
  select role into t from platform_suggestions where user_id = v_t;
  r := r || pg_temp.chk('W3b', 'its stored role is tutor', t, 'tutor');
  r := r || pg_temp.chk('W4', 'a person cannot name the role', pg_temp.deny(pg_temp.do_as(v_l, format('insert into public.platform_suggestions (user_id, body, role) values (%L, ''x'', ''tutor'')', v_l))), 'ERR: permission denied for');
  r := r || pg_temp.chk('W5', 'a person cannot name the status', pg_temp.deny(pg_temp.do_as(v_l, format('insert into public.platform_suggestions (user_id, body, status) values (%L, ''x'', ''done'')', v_l))), 'ERR: permission denied for');
  r := r || pg_temp.chk('W6', 'a person cannot write the internal note', pg_temp.deny(pg_temp.do_as(v_l, format('insert into public.platform_suggestions (user_id, body, admin_note) values (%L, ''x'', ''n'')', v_l))), 'ERR: permission denied for');
  r := r || pg_temp.chk('W7', 'a person cannot name who handled it, when, or the date it was made',
    pg_temp.deny(pg_temp.do_as(v_l, format('insert into public.platform_suggestions (user_id, body, handled_by) values (%L, ''x'', %L)', v_l, v_sa))) || ' / ' ||
    pg_temp.deny(pg_temp.do_as(v_l, format('insert into public.platform_suggestions (user_id, body, handled_at) values (%L, ''x'', now())', v_l))) || ' / ' ||
    pg_temp.deny(pg_temp.do_as(v_l, format('insert into public.platform_suggestions (user_id, body, created_at) values (%L, ''x'', now() - interval ''9 days'')', v_l))),
    'ERR: permission denied for / ERR: permission denied for / ERR: permission denied for');
  r := r || pg_temp.chk('W8', 'a person cannot add one in someone else''s name (row-level security)',
    pg_temp.pfx(pg_temp.do_as(v_l, format('insert into public.platform_suggestions (user_id, body) values (%L, ''pretend'')', v_t)), 'ERR: new row violates row-level security'), 'ERR: new row violates row-level security');
  r := r || pg_temp.chk('W9', 'a signed-out caller cannot add one', pg_temp.deny(pg_temp.do_as(null, format('insert into public.platform_suggestions (user_id, body) values (%L, ''spam'')', v_l))), 'ERR: permission denied for');
  r := r || pg_temp.chk('W10', 'the server''s key cannot add one either (it never needs to)', pg_temp.deny(pg_temp.as_service(format('insert into public.platform_suggestions (user_id, body) values (%L, ''x'') returning ''done''', v_l))), 'ERR: permission denied for');
  select count(*)::text into t from platform_suggestions where user_id in (v_l, v_t);
  r := r || pg_temp.chk('W11', 'only the two real sends are stored so far', t, '2');

  -- ---- LEN: length checks -----------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('LEN1', 'an empty text is refused in plain words', pg_temp.send(v_o, ''), 'ERR: Please write your suggestion first.');
  r := r || pg_temp.chk('LEN2', 'spaces and new lines only are refused', pg_temp.send(v_o, E'   \n  '), 'ERR: Please write your suggestion first.');
  -- Line breaks and tabs count as blank too (the first production run, 9 Nov 2026, found the one-argument btrim trimmed spaces only).
  r := r || pg_temp.chk('LEN2b', 'a text of only line breaks is refused', pg_temp.send(v_o, E'\n\n\r\n'), 'ERR: Please write your suggestion first.');
  r := r || pg_temp.chk('LEN2c', 'a text of only tabs is refused', pg_temp.send(v_o, E'\t\t'), 'ERR: Please write your suggestion first.');
  r := r || pg_temp.chk('LEN2d', 'a text of spaces, tabs, carriage returns and line breaks mixed is refused', pg_temp.send(v_o, E' \t\r\n \t\n '), 'ERR: Please write your suggestion first.');
  t2 := pg_temp.send(v_o, E'\n first line\nsecond line\n\n');
  select replace(replace(body, E'\r', '<CR>'), E'\n', '<LF>') into t from platform_suggestions where user_id = v_o;
  r := r || pg_temp.chk('LEN2e', 'an inner line break is kept, the leading and trailing blanks and line breaks are trimmed', t2 || ' / ' || coalesce(t, 'none'), 'done / first line<LF>second line');
  delete from platform_suggestions where user_id = v_o;
  -- A NULL body reads as empty (the coalesce in the trigger): refused in plain words, not later by the not-null rule.
  r := r || pg_temp.chk('LEN2f', 'a NULL body is refused in plain words, not by the not-null rule', pg_temp.send(v_o, null), 'ERR: Please write your suggestion first.');
  r := r || pg_temp.chk('LEN3', '1,001 characters are refused in plain words', pg_temp.send(v_o, v_big || 'b'), 'ERR: Please keep your suggestion to 1,000 characters or fewer.');
  r := r || pg_temp.chk('LEN4', 'exactly 1,000 characters are accepted', pg_temp.send(v_o, v_big), 'done');
  select char_length(body)::text into t from platform_suggestions where user_id = v_o;
  r := r || pg_temp.chk('LEN5', 'and stored whole', t, '1000');
  delete from platform_suggestions where user_id = v_o;
  r := r || pg_temp.chk('LEN6', '1,000 accented letters (2,000 bytes) are accepted: the limit counts characters', pg_temp.send(v_o, repeat('é', 1000)), 'done');
  delete from platform_suggestions where user_id = v_o;
  r := r || pg_temp.chk('LEN7', 'one character is accepted', pg_temp.send(v_o, 'x'), 'done');
  delete from platform_suggestions where user_id = v_o;
  -- the table's own checks, with the insert trigger switched off for a moment (as the owner), so the constraints are what refuses
  alter table public.platform_suggestions disable trigger platform_suggestions_before_insert;
  begin
    insert into platform_suggestions (user_id, role, body) values (v_o, 'student', v_big || 'b');
    t := 'no error';
  exception when check_violation then t := 'refused: ' || split_part(sqlerrm, '"', 4);
  end;
  begin
    insert into platform_suggestions (user_id, role, body, status) values (v_o, 'student', 'x', 'banana');
    t2 := 'no error';
  exception when check_violation then t2 := 'refused: ' || split_part(sqlerrm, '"', 4);
  end;
  alter table public.platform_suggestions enable trigger platform_suggestions_before_insert;
  r := r || pg_temp.chk('LEN8', 'the table itself refuses a 1,001-character text and an unknown status, whoever writes (check constraints)',
    t || ' / ' || t2, 'refused: platform_suggestions_body_length / refused: platform_suggestions_status_values');

  -- ---- H: the database stores exactly what was typed; the screens print it as plain text ----------------------------------------------------------
  r := r || pg_temp.chk('H1', 'text with tags is stored as typed (nothing is rendered from it anywhere)', pg_temp.send(v_o, '<b>bold</b> <script>alert(1)</script> a < b & c > d'), 'done');
  select body into t from platform_suggestions where user_id = v_o;
  r := r || pg_temp.chk('H1b', 'the stored text', t, '<b>bold</b> <script>alert(1)</script> a < b & c > d');
  delete from platform_suggestions where user_id = v_o;

  -- ---- L: at most 5 in any 24 hours -------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('L1', 'the learner''s sends 2 to 5 are accepted',
    pg_temp.send(v_l, 'two') || '/' || pg_temp.send(v_l, 'three') || '/' || pg_temp.send(v_l, 'four') || '/' || pg_temp.send(v_l, 'five'), 'done/done/done/done');
  select count(*)::text into t from platform_suggestions where user_id = v_l;
  r := r || pg_temp.chk('L1b', 'the learner now has 5 rows', t, '5');
  r := r || pg_temp.chk('L2', 'the 6th in the same day is refused in plain words', pg_temp.send(v_l, 'six'), 'ERR: You can send up to 5 suggestions a day. Please try again tomorrow.');
  select count(*)::text into t from platform_suggestions where user_id = v_l;
  r := r || pg_temp.chk('L2b', 'and not stored', t, '5');
  r := r || pg_temp.chk('L3', 'the limit is per person: the tutor can still send', pg_temp.send(v_t, 'a second one from the tutor'), 'done');
  update platform_suggestions set created_at = now() - interval '25 hours' where user_id = v_l and body in ('two', 'three');
  r := r || pg_temp.chk('L4', 'two of the five are older than 24 hours, so only 3 count: the learner can send again', pg_temp.send(v_l, 'six, a day later'), 'done');
  r := r || pg_temp.chk('L4b', 'now 4 count: one more is accepted, the one after that is refused',
    pg_temp.send(v_l, 'seven') || ' / ' || pg_temp.pfx(pg_temp.send(v_l, 'eight'), 'ERR: You can send up to 5'), 'done / ERR: You can send up to 5');
  update platform_suggestions set created_at = now() - interval '2 days' where user_id = v_l;
  r := r || pg_temp.chk('L5', 'a day later everything has reopened', pg_temp.send(v_l, 'a fresh day'), 'done');

  -- ---- R: who can read ---------------------------------------------------------------------------------------------------------------------------
  select count(*) into v_total from platform_suggestions;
  r := r || pg_temp.chk('R0', 'the table holds 8 rows from the learner and 2 from the tutor', v_total::text, '10');
  r := r || pg_temp.chk('R1', 'the learner cannot read the table, not even their own rows (the internal note sits on the same row): 0 rows', pg_temp.run_as(v_l, 'select count(*)::text from public.platform_suggestions'), '0');
  r := r || pg_temp.chk('R2', 'the tutor reads 0 rows', pg_temp.run_as(v_t, 'select count(*)::text from public.platform_suggestions'), '0');
  r := r || pg_temp.chk('R3', 'a signed-out caller is refused', pg_temp.deny(pg_temp.run_as(null, 'select count(*)::text from public.platform_suggestions')), 'ERR: permission denied for');
  r := r || pg_temp.chk('R4', 'a support agent reads every row', pg_temp.run_as(v_su, 'select count(*)::text from public.platform_suggestions'), v_total::text);
  r := r || pg_temp.chk('R5', 'a finance manager reads every row', pg_temp.run_as(v_fm, 'select count(*)::text from public.platform_suggestions'), v_total::text);
  r := r || pg_temp.chk('R6', 'a super admin reads every row', pg_temp.run_as(v_sa, 'select count(*)::text from public.platform_suggestions'), v_total::text);
  r := r || pg_temp.chk('R7', 'a switched-off admin reads 0 rows', pg_temp.run_as(v_of, 'select count(*)::text from public.platform_suggestions'), '0');
  r := r || pg_temp.chk('R8', 'an admin reads the whole row (text, role, status, date)',
    pg_temp.run_as(v_su, $q$select (count(*) filter (where body is not null and role is not null and status is not null and created_at is not null))::text from public.platform_suggestions$q$), v_total::text);
  r := r || pg_temp.chk('R9', 'the server''s key cannot read the table (it never needs to)', pg_temp.deny(pg_temp.as_service('select count(*)::text from public.platform_suggestions')), 'ERR: permission denied for');
  -- The admin page reads each row with two joins (profiles for the name, admin_profiles for "handled by"). A join only returns what the admin may read.
  r := r || pg_temp.chk('R10', 'an admin can read the author''s profile (the page joins profiles for the name; if this fails every name reads "Someone")',
    pg_temp.run_as(v_su, format('select count(*)::text from public.profiles where id = %L', v_l)), '1');
  r := r || pg_temp.chk('R11', 'an admin can read another admin''s name (the page joins admin_profiles for "handled by"; if this fails that name stays blank)',
    pg_temp.run_as(v_su, format('select count(*)::text from public.admin_profiles where id = %L', v_sa)), '1');

  -- ---- M: my_platform_suggestions() (a person's own text and date, never the internal parts) ----------------------------------------------------
  r := r || pg_temp.chk('M1', 'the learner reads their own 8 rows through the function', pg_temp.run_as(v_l, 'select count(*)::text from public.my_platform_suggestions()'), '8');
  r := r || pg_temp.chk('M2', 'the tutor reads only their own 2', pg_temp.run_as(v_t, 'select count(*)::text from public.my_platform_suggestions()'), '2');
  r := r || pg_temp.chk('M3', 'a signed-out caller is refused', pg_temp.deny(pg_temp.run_as(null, 'select count(*)::text from public.my_platform_suggestions()')), 'ERR: permission denied for');
  r := r || pg_temp.chk('M4', 'the function returns only id, body and created_at', pg_get_function_result('public.my_platform_suggestions()'::regprocedure), 'TABLE(id uuid, body text, created_at timestamp with time zone)');
  r := r || pg_temp.chk('M5', 'newest first', pg_temp.run_as(v_l, 'select body from public.my_platform_suggestions() limit 1'), 'a fresh day');

  -- ---- A: the admin's one write -----------------------------------------------------------------------------------------------------------------
  select id into v_sid from platform_suggestions where user_id = v_t and body = 'A way to message my learners';
  select (to_jsonb(x) - 'status' - 'admin_note' - 'handled_at' - 'handled_by')::text into v_before from platform_suggestions x where id = v_sid;
  r := r || pg_temp.chk('A1', 'a support agent marks it planned with a note', pg_temp.handle(v_su, v_sid, 'planned', E'  Do this after exams  '), 'planned');
  select (status || '|' || coalesce(admin_note, '-') || '|' || (handled_by = v_su)::text || '|' || (handled_at is not null)::text) into t from platform_suggestions where id = v_sid;
  r := r || pg_temp.chk('A2', 'status, trimmed note, who and when are stored', t, 'planned|Do this after exams|true|true');
  select (to_jsonb(x) - 'status' - 'admin_note' - 'handled_at' - 'handled_by')::text into v_after from platform_suggestions x where id = v_sid;
  r := r || pg_temp.chk('A3', 'nothing else on the row changed (text, person, role, date)', (v_before = v_after)::text, 'true');
  r := r || pg_temp.chk('A4', 'a super admin marks it done with a blank note: the note is cleared', pg_temp.handle(v_sa, v_sid, 'done', '   '), 'done');
  select (coalesce(admin_note, '-') || '|' || (handled_by = v_sa)::text) into t from platform_suggestions where id = v_sid;
  r := r || pg_temp.chk('A4b', 'no note, and the stamp is the super admin''s', t, '-|true');
  r := r || pg_temp.chk('A5', 'a finance manager can dismiss it', pg_temp.handle(v_fm, v_sid, 'dismissed', 'duplicate'), 'dismissed');
  r := r || pg_temp.chk('A6', 'back to new clears who and when but keeps the note', pg_temp.handle(v_su, v_sid, 'new', 'keep'), 'new');
  select (coalesce(handled_at::text, '-') || '|' || coalesce(handled_by::text, '-') || '|' || coalesce(admin_note, '-')) into t from platform_suggestions where id = v_sid;
  r := r || pg_temp.chk('A6b', 'the stored state', t, '-|-|keep');
  r := r || pg_temp.chk('A7', 'the learner cannot call it', pg_temp.handle(v_l, v_sid, 'done', 'x'), 'ERR: Only an active admin can handle suggestions');
  r := r || pg_temp.chk('A8', 'the tutor cannot call it', pg_temp.handle(v_t, v_sid, 'done', 'x'), 'ERR: Only an active admin can handle suggestions');
  r := r || pg_temp.chk('A9', 'a switched-off admin cannot call it', pg_temp.handle(v_of, v_sid, 'done', 'x'), 'ERR: Only an active admin can handle suggestions');
  r := r || pg_temp.chk('A10', 'a signed-out caller cannot call it', pg_temp.deny(pg_temp.handle(null, v_sid, 'done', 'x')), 'ERR: permission denied for');
  r := r || pg_temp.chk('A11', 'a made-up status is refused', pg_temp.handle(v_su, v_sid, 'banana', 'x'), 'ERR: Choose a status: new, read, planned, done or dismissed');
  r := r || pg_temp.chk('A12', 'no status is refused', pg_temp.run_as(v_su, format($q$select public.admin_handle_suggestion(%L, null, 'x')::text$q$, v_sid)), 'ERR: Choose a status: new, read, planned, done or dismissed');
  r := r || pg_temp.chk('A13', 'a note of 1,001 characters is refused', pg_temp.handle(v_su, v_sid, 'read', repeat('n', 1001)), 'ERR: The note can be 1,000 characters at most');
  r := r || pg_temp.chk('A14', 'a suggestion that does not exist is refused', pg_temp.handle(v_su, gen_random_uuid(), 'read', 'x'), 'ERR: No such suggestion');
  select count(*)::text into t from platform_suggestions where id = v_sid and status = 'new' and admin_note = 'keep';
  r := r || pg_temp.chk('A14b', 'and none of the refusals changed the row', t, '1');
  perform pg_temp.handle(v_su, v_sid, 'planned', 'INTERNAL: follow up with the CEO');
  r := r || pg_temp.chk('A15', 'the person who wrote it never sees the note, the status or the admin: nothing of it in what they can read',
    pg_temp.run_as(v_t, $q$select (coalesce(bool_or(to_jsonb(m)::text ilike '%INTERNAL%' or to_jsonb(m)::text ilike '%planned%' or to_jsonb(m)::text ilike '%handled%'), false))::text from public.my_platform_suggestions() m$q$), 'false');

  -- ---- D: no direct writes by anyone through the API ---------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('D1', 'a support agent cannot update a row directly', pg_temp.deny(pg_temp.do_as(v_su, format('update public.platform_suggestions set status = ''done'' where id = %L', v_sid))), 'ERR: permission denied for');
  r := r || pg_temp.chk('D2', 'a super admin cannot update a row directly (no blanket write)', pg_temp.deny(pg_temp.do_as(v_sa, format('update public.platform_suggestions set admin_note = ''x'' where id = %L', v_sid))), 'ERR: permission denied for');
  r := r || pg_temp.chk('D3', 'an admin cannot rewrite the person''s text', pg_temp.deny(pg_temp.do_as(v_sa, format('update public.platform_suggestions set body = ''edited'' where id = %L', v_sid))), 'ERR: permission denied for');
  r := r || pg_temp.chk('D4', 'an admin cannot delete a row', pg_temp.deny(pg_temp.do_as(v_sa, format('delete from public.platform_suggestions where id = %L', v_sid))), 'ERR: permission denied for');
  r := r || pg_temp.chk('D5', 'the person cannot update or delete their own row',
    pg_temp.deny(pg_temp.do_as(v_t, format('update public.platform_suggestions set status = ''done'' where id = %L', v_sid))) || ' / ' || pg_temp.deny(pg_temp.do_as(v_t, format('delete from public.platform_suggestions where id = %L', v_sid))),
    'ERR: permission denied for / ERR: permission denied for');
  select count(*)::text into t from platform_suggestions where id = v_sid and body = 'A way to message my learners' and status = 'planned';
  r := r || pg_temp.chk('D6', 'and the row is exactly as the admin function left it', t, '1');

  -- ---- C: closing an account deletes the person's suggestions (the hook on the deletion record) --------------------------------------------------
  perform pg_temp.send(v_o, 'one from Otto');
  perform pg_temp.send(v_o, 'and another from Otto');
  select count(*) into v_total from platform_suggestions where user_id <> v_o;
  insert into account_deletion_records (closure_id, profile_id, role, started_by, started_how, closed_at, deleted, kept, outside)
    values (gen_random_uuid(), v_o, 'student', v_o, 'self', now(), '{"notifications": 3}'::jsonb, '[]'::jsonb, '[]'::jsonb) returning deleted ->> 'platform_suggestions' into t;
  r := r || pg_temp.chk('C1', 'the deletion record counts the 2 suggestions it deleted', t, '2');
  select count(*)::text into t from platform_suggestions where user_id = v_o;
  r := r || pg_temp.chk('C2', 'Otto has none left', t, '0');
  select count(*)::text into t from platform_suggestions where user_id <> v_o;
  r := r || pg_temp.chk('C3', 'everybody else''s are untouched', t, v_total::text);
  select (deleted ->> 'notifications') into t from account_deletion_records where profile_id = v_o;
  r := r || pg_temp.chk('C4', 'the rest of the deletion record is as it was written', t, '3');

  -- ---- N: the top-up pilot notice -----------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('N1', 'the starting row exists (the migration inserted it)', (select count(*)::text from system_settings where setting_key = 'topup_pilot_notice'), '1');
  r := r || pg_temp.chk('N2', 'a learner reads it through the function: enabled, times and text with the {times} marker',
    pg_temp.run_as(v_l, $q$select ((public.topup_pilot_notice()->>'enabled') || '|' || (length(public.topup_pilot_notice()->>'times') > 10)::text || '|' || ((public.topup_pilot_notice()->>'text') like '%{times}%')::text)$q$), 'true|true|true');
  r := r || pg_temp.chk('N3', 'the words say every transfer is checked by a person and a tutor is paid after the session',
    pg_temp.run_as(v_l, $q$select ((public.topup_pilot_notice()->>'text') like '%every bank transfer is checked by a person%' and (public.topup_pilot_notice()->>'text') like '%A tutor is only paid after your session is complete.%')::text$q$), 'true');
  r := r || pg_temp.chk('N4', 'the words and the description never say free',
    (select (v ~* '\yfree\y')::text from (select (setting_value::text || ' ' || coalesce(description, '')) as v from system_settings where setting_key = 'topup_pilot_notice') x), 'false');
  r := r || pg_temp.chk('N5', 'a signed-out caller cannot read it', pg_temp.deny(pg_temp.run_as(null, 'select public.topup_pilot_notice()::text')), 'ERR: permission denied for');
  -- Existing behaviour, written down (found by the first production run, 9 Nov 2026): the policy "Public view non-sensitive system settings" lets a
  -- signed-in person read system_settings rows (a signed-out caller cannot). The notice is shown to them anyway, so nothing here is hidden; the app
  -- still asks the function (N2), which has a fixed shape. If that policy is ever narrowed this line says so.
  r := r || pg_temp.chk('N6', 'a signed-in person can read the setting row directly (existing policy "Public view non-sensitive system settings"; N5 is the signed-out refusal)',
    pg_temp.run_as(v_l, $q$select count(*)::text from public.system_settings where setting_key = 'topup_pilot_notice'$q$), '1');
  v_has_guard := to_regprocedure('public.settings_is_super_admin()') is not null;
  r := r || pg_temp.chk('N7', case when v_has_guard then 'a support agent cannot change the notice (super admin only: 20261104210000 is installed)' else 'a support agent cannot change the notice: n/a, 20261104210000 is not installed here' end,
    case when v_has_guard then pg_temp.pfx(pg_temp.run_as(v_su, $q$with u as (update public.system_settings set setting_value = '"x"'::jsonb where setting_key = 'topup_pilot_notice' returning 1) select count(*)::text from u$q$), 'ERR: Only a super admin can change system settings') else 'n/a' end,
    case when v_has_guard then 'ERR: Only a super admin can change system settings' else 'n/a' end);
  r := r || pg_temp.chk('N8', 'a super admin can change the notice (no publish needed) and the learner then reads the new words',
    pg_temp.run_as(v_sa, $q$with u as (update public.system_settings set setting_value = '{"enabled": true, "times": "5 hours"}'::jsonb where setting_key = 'topup_pilot_notice' returning 1) select count(*)::text from u$q$)
    || ' / ' || pg_temp.run_as(v_l, $q$select public.topup_pilot_notice()->>'times'$q$), '1 / 5 hours');
  delete from system_settings where setting_key = 'topup_pilot_notice';
  r := r || pg_temp.chk('N9', 'with the row gone the function answers null (the app then uses its own default words)', pg_temp.run_as(v_l, 'select public.topup_pilot_notice()::text'), 'null');

  -- ---- S: the shape of the thing -------------------------------------------------------------------------------------------------------------------
  select string_agg(column_name, ',' order by ordinal_position) into t from information_schema.columns where table_schema = 'public' and table_name = 'platform_suggestions';
  r := r || pg_temp.chk('S1', 'columns', t, 'id,user_id,role,body,status,admin_note,created_at,handled_at,handled_by');
  r := r || pg_temp.chk('S2', 'row security is on', (select relrowsecurity::text from pg_class where oid = 'public.platform_suggestions'::regclass), 'true');
  select string_agg(policyname || ':' || cmd, ' | ' order by policyname) into t from pg_policies where schemaname = 'public' and tablename = 'platform_suggestions';
  r := r || pg_temp.chk('S3', 'the only policies: an own-row insert and an admin read', t, 'Admins read all suggestions:SELECT | Users add their own suggestion:INSERT');
  r := r || pg_temp.chk('S4', 'table rights for signed-in people: select/insert/update/delete',
    has_table_privilege('authenticated', 'public.platform_suggestions', 'select')::text || '/' || has_table_privilege('authenticated', 'public.platform_suggestions', 'insert')::text || '/'
    || has_table_privilege('authenticated', 'public.platform_suggestions', 'update')::text || '/' || has_table_privilege('authenticated', 'public.platform_suggestions', 'delete')::text, 'true/false/false/false');
  r := r || pg_temp.chk('S5', 'insert is allowed on user_id and body only (user_id/body/role/status/admin_note/handled_by)',
    has_column_privilege('authenticated', 'public.platform_suggestions', 'user_id', 'insert')::text || '/' || has_column_privilege('authenticated', 'public.platform_suggestions', 'body', 'insert')::text || '/'
    || has_column_privilege('authenticated', 'public.platform_suggestions', 'role', 'insert')::text || '/' || has_column_privilege('authenticated', 'public.platform_suggestions', 'status', 'insert')::text || '/'
    || has_column_privilege('authenticated', 'public.platform_suggestions', 'admin_note', 'insert')::text || '/' || has_column_privilege('authenticated', 'public.platform_suggestions', 'handled_by', 'insert')::text,
    'true/true/false/false/false/false');
  r := r || pg_temp.chk('S6', 'signed-out and the server''s key have no right on the table (anon select/insert, service select/insert)',
    has_table_privilege('anon', 'public.platform_suggestions', 'select')::text || '/' || has_table_privilege('anon', 'public.platform_suggestions', 'insert')::text || '/'
    || has_table_privilege('service_role', 'public.platform_suggestions', 'select')::text || '/' || has_table_privilege('service_role', 'public.platform_suggestions', 'insert')::text, 'false/false/false/false');
  select count(*)::text into t from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('platform_suggestions_before_insert', 'admin_handle_suggestion', 'my_platform_suggestions', 'platform_suggestions_on_closure', 'topup_pilot_notice')
    and p.proconfig is not null and 'search_path=public' = any (p.proconfig);
  r := r || pg_temp.chk('S7', 'all five new functions pin search_path=public', t, '5');
  r := r || pg_temp.chk('S8', 'who may run the three public functions (signed-in/signed-out for each)',
    has_function_privilege('authenticated', 'public.admin_handle_suggestion(uuid,text,text)', 'execute')::text || '/' || has_function_privilege('anon', 'public.admin_handle_suggestion(uuid,text,text)', 'execute')::text || '/'
    || has_function_privilege('authenticated', 'public.my_platform_suggestions()', 'execute')::text || '/' || has_function_privilege('anon', 'public.my_platform_suggestions()', 'execute')::text || '/'
    || has_function_privilege('authenticated', 'public.topup_pilot_notice()', 'execute')::text || '/' || has_function_privilege('anon', 'public.topup_pilot_notice()', 'execute')::text,
    'true/false/true/false/true/false');
  r := r || pg_temp.chk('S9', 'the two trigger functions cannot be called by a signed-in person',
    has_function_privilege('authenticated', 'public.platform_suggestions_before_insert()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.platform_suggestions_on_closure()', 'execute')::text, 'false/false');
  select string_agg(c.relname || '.' || tg.tgname, ' | ' order by tg.tgname) into t from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where not tg.tgisinternal and tg.tgname in ('platform_suggestions_before_insert', 'platform_suggestions_on_closure');
  r := r || pg_temp.chk('S10', 'the two triggers exist', t, 'platform_suggestions.platform_suggestions_before_insert | account_deletion_records.platform_suggestions_on_closure');
  select string_agg(conname, ',' order by conname) into t from pg_constraint
    where conrelid = 'public.platform_suggestions'::regclass and conname in ('platform_suggestions_user_id_fkey', 'platform_suggestions_handled_by_fkey');
  r := r || pg_temp.chk('S11', 'the two foreign keys are named as the admin app asks for them (profiles!platform_suggestions_user_id_fkey)', t, 'platform_suggestions_handled_by_fkey,platform_suggestions_user_id_fkey');
  -- PostgREST builds its joins from these definitions: one key to profiles and one to admin_profiles, so each name in the admin page's select is unambiguous.
  select string_agg(replace(conname || ' ' || pg_get_constraintdef(oid), 'public.', ''), ' | ' order by conname) into t from pg_constraint
    where conrelid = 'public.platform_suggestions'::regclass and contype = 'f';
  r := r || pg_temp.chk('S11b', 'the keys point where the joins need them: handled_by to admin_profiles, user_id to profiles (and no other foreign key)', t,
    'platform_suggestions_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES admin_profiles(id) ON DELETE SET NULL | platform_suggestions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE');
  r := r || pg_temp.chk('Q1', 'the insert trigger takes an advisory lock for the person BEFORE it counts their sends',
    (select (prosrc like '%pg_advisory_xact_lock%' and position('pg_advisory_xact_lock' in prosrc) < position('count(*)' in prosrc))::text from pg_proc where proname = 'platform_suggestions_before_insert' and pronamespace = 'public'::regnamespace), 'true');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  -- The answer is short on purpose: the Supabase tool cuts the middle of a long error. Every FAIL line is printed in full; the lines that passed are
  -- listed by their ids only (each id is the first word of its line in this file).
  select count(*) filter (where l like '%FAIL%'), count(*) filter (where l like '% ok'), count(*) into nfail, nok, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  select coalesce(string_agg(l, E'\n') filter (where l like '%FAIL%'), '(none)') into t from unnest(string_to_array(r, E'\n')) l;
  select string_agg(split_part(l, ' ', 1), ' ') filter (where l like '% ok') into t2 from unnest(string_to_array(r, E'\n')) l;
  raise exception E'PLATFORM SUGGESTIONS TEST (rolled back): % OK, % FAIL, % lines in all\nFAIL LINES: %\nOK: %', nok, nfail, nlines, t, t2;
end $$;
