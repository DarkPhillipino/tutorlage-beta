-- Rolled-back test of error tracking (release gate OPS-ERRORS-01, migration 20261020160000_client_errors). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs) before the migration is applied, or on its
-- own after. Every line ends "ok" or "FAIL"; refusals print the start of the database's own message so a refusal for the wrong
-- reason is visible. Lines are short on purpose: the Supabase tool cuts a long answer in the middle.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_learner uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_admin_off uuid := gen_random_uuid();      -- an admin whose access is switched off
  v_msg text := 'Cannot read properties of undefined (reading ''map'')';
  v_dirty text;
  v_big text := repeat('x ', 3000);
  v_stack text := repeat(E'at x (https://tutorlage.example/assets/index.js:1:2)\n', 100);
  n int; n0 int; v_over0 int; v_over1 int; v_occ int; v_si int; t text; row_t public.client_errors;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_learner, z, 'authenticated', 'authenticated', 'ce.l.' || v_learner || '@example.invalid', jsonb_build_object('role', 'student', 'date_of_birth', adult), '{}'),
    (v_tutor, z, 'authenticated', 'authenticated', 'ce.t.' || v_tutor || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T', 'date_of_birth', adult), '{}'),
    (v_admin, z, 'authenticated', 'authenticated', 'ce.a.' || v_admin || '@example.invalid', '{}'::jsonb, '{}'),
    (v_admin_off, z, 'authenticated', 'authenticated', 'ce.o.' || v_admin_off || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'T', 'Admin', 'x@example.invalid', '');
  insert into admin_profiles (id, first_name, surname, email, phone_number, is_active) values (v_admin_off, 'O', 'Off', 'y@example.invalid', '', false);

  select count(*) into n0 from client_errors;
  r := r || format('C0 setup: rows before=%s', n0) || E'\n';

  -- ---- who can write: only through the function ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('render', v_msg, '/ [prices]', E'at Prices\nat App', 'Chrome Android');
  reset role;
  select occurrences, signed_in_occurrences into v_occ, v_si from client_errors where message = v_msg;
  select count(*) into n from client_errors where message = v_msg;
  r := r || format('C1 signed OUT caller logs an error: rows=%s occ=%s signedIn=%s %s', n, v_occ, v_si, case when n = 1 and v_occ = 1 and v_si = 0 then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('render', v_msg, '/ [prices]');
  reset role;
  select occurrences, signed_in_occurrences into v_occ, v_si from client_errors where message = v_msg;
  select count(*) into n from client_errors where message = v_msg;
  r := r || format('C2 the same error again is counted, not added: rows=%s occ=%s %s', n, v_occ, case when n = 1 and v_occ = 2 and v_si = 0 then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.log_client_error('render', v_msg, '/ [prices]');
  reset role;
  select occurrences, signed_in_occurrences into v_occ, v_si from client_errors where message = v_msg;
  r := r || format('C3 a SIGNED-IN caller is counted as signed in (read from the sign-in): occ=%s signedIn=%s %s', v_occ, v_si, case when v_occ = 3 and v_si = 1 then 'ok' else 'FAIL' end) || E'\n';

  select * into row_t from client_errors where message = v_msg;
  r := r || format('C3b the first details and browser are kept: %s %s', row_t.browser, case when row_t.browser = 'Chrome Android' and row_t.details like 'at Prices%' and row_t.kind = 'render' and row_t.screen = '/ [prices]' then 'ok' else 'FAIL' end) || E'\n';

  -- ---- direct writes are refused to every browser role ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    insert into client_errors (fingerprint, kind, message, screen) values ('x1', 'logged', 'direct', '/');
    r := r || 'C4 FAIL: signed OUT insert worked' || E'\n';
  exception when others then r := r || format('C4 signed OUT direct insert refused: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into client_errors (fingerprint, kind, message, screen) values ('x2', 'logged', 'direct', '/');
    r := r || 'C5 FAIL: signed-in insert worked' || E'\n';
  exception when others then r := r || format('C5 signed-in direct insert refused: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  begin
    update client_errors set occurrences = 0;
    r := r || 'C6 FAIL: signed-in update worked' || E'\n';
  exception when others then r := r || format('C6 signed-in direct update refused: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  begin
    delete from client_errors;
    r := r || 'C7 FAIL: signed-in delete worked' || E'\n';
  exception when others then r := r || format('C7 signed-in direct delete refused: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into client_errors (fingerprint, kind, message, screen) values ('x3', 'logged', 'direct', '/');
    r := r || 'C8 FAIL: an admin insert worked' || E'\n';
  exception when others then r := r || format('C8 even an admin cannot write directly: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  reset role;

  -- ---- who can read: active admins only ------------------------------------------------------------------------------------
  select count(*) into n0 from client_errors;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    select count(*) into n from client_errors;
    r := r || format('C9 FAIL: signed OUT read worked, rows=%s', n) || E'\n';
  exception when others then r := r || format('C9 signed OUT read refused: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from client_errors;
  reset role;
  r := r || format('C10 a signed-in learner sees rows=%s (want 0) %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from client_errors;
  reset role;
  r := r || format('C11 a signed-in tutor sees rows=%s (want 0) %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_off, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from client_errors;
  reset role;
  r := r || format('C12 an admin whose access is OFF sees rows=%s (want 0) %s', n, case when n = 0 then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from client_errors;
  reset role;
  r := r || format('C13 an active admin sees rows=%s (want %s) %s', n, n0, case when n = n0 and n > 0 then 'ok' else 'FAIL' end) || E'\n';

  -- ---- sizes are capped -----------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('unhandled', v_big, repeat('/abc', 300), v_stack, repeat('B ', 250));
  reset role;
  select * into row_t from client_errors where kind = 'unhandled' and message like 'x x x%';
  r := r || format('C14 oversize fields are cut: message=%s screen=%s details=%s browser=%s (want <=300,<=120,<=1500,<=80) %s',
    char_length(row_t.message), char_length(row_t.screen), char_length(row_t.details), char_length(row_t.browser),
    case when char_length(row_t.message) <= 300 and char_length(row_t.screen) <= 120 and char_length(row_t.details) <= 1500 and char_length(row_t.browser) <= 80 then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('banana', '', null, '   ', null);
  reset role;
  select * into row_t from client_errors where message = 'Unknown error' and kind = 'logged';
  r := r || format('C15 odd input is tidied: kind=%s message=%s screen=%s details=%s %s', row_t.kind, row_t.message, row_t.screen, coalesce(row_t.details, 'null'),
    case when row_t.kind = 'logged' and row_t.screen = '/' and row_t.details is null then 'ok' else 'FAIL' end) || E'\n';

  -- ---- no personal data is kept ---------------------------------------------------------------------------------------------
  v_dirty := 'Failed for jane.doe@example.com token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123 id 3f2a1b4c-1111-2222-3333-444455556666'
    || ' phone 082 123 4567 key ' || 'sk_' || 'live_' || repeat('a', 36) || ' at https://tutorlage.example/pay?reference=SECRET123&email=x#frag end';
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('rejection', v_dirty, '/payment/callback?reference=SECRET123', 'stack for jane.doe@example.com', 'Safari iOS');
  reset role;
  select * into row_t from client_errors where kind = 'rejection' and message like 'Failed for%';
  r := r || format('C16 stored message: %s', row_t.message) || E'\n';
  r := r || format('C16b nothing personal left %s; markers present %s',
    case when row_t.message !~* 'jane\.doe|eyJ|3f2a1b4c|082 123|sk_live|SECRET123|frag' and row_t.details !~* 'jane\.doe' then 'ok' else 'FAIL' end,
    case when row_t.message like '%[email]%' and row_t.message like '%[token]%' and row_t.message like '%[id]%' and row_t.message like '%[number]%' and row_t.message like '%https://tutorlage.example/pay %' then 'ok' else 'FAIL' end) || E'\n';
  r := r || format('C16c the address query is gone from the screen: %s %s', row_t.screen, case when row_t.screen = '/payment/callback' then 'ok' else 'FAIL' end) || E'\n';
  select message into t from client_errors where kind = 'render' and message = v_msg;
  r := r || format('C17 an ordinary message is not changed %s', case when t = v_msg then 'ok' else 'FAIL' end) || E'\n';

  r := r || format('C18 screens: %s | %s | %s %s',
    public.scrub_client_error_screen('/tutorlage-beta/room/AB12-CD34 [room]'),
    public.scrub_client_error_screen('/x/3f2a1b4c-1111-2222-3333-444455556666/edit'),
    public.scrub_client_error_screen('/signup/tutor'),
    case when public.scrub_client_error_screen('/tutorlage-beta/room/AB12-CD34 [room]') = '/tutorlage-beta/room/:code [room]'
          and public.scrub_client_error_screen('/x/3f2a1b4c-1111-2222-3333-444455556666/edit') = '/x/:id/edit'
          and public.scrub_client_error_screen('/signup/tutor') = '/signup/tutor' then 'ok' else 'FAIL' end) || E'\n';

  -- ---- a flood cannot fill the table --------------------------------------------------------------------------------------
  select count(*) into n0 from client_errors where kind <> 'overflow' and first_seen > now() - interval '1 hour';
  select coalesce(max(occurrences), 0) into v_over0 from client_errors where kind = 'overflow';
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  for i in 1..70 loop
    perform public.log_client_error('logged', 'flood ' || i, '/flood');
  end loop;
  reset role;
  select count(*) into n from client_errors where kind <> 'overflow' and first_seen > now() - interval '1 hour';
  select coalesce(max(occurrences), 0) into v_over1 from client_errors where kind = 'overflow';
  r := r || format('C19 70 made-up errors: new kinds an hour went %s -> %s (want 60 at most); overflow row counted %s (want %s) %s',
    n0, n, v_over1 - v_over0, 70 - (n - n0),
    case when n <= 60 and n > n0 and v_over1 - v_over0 = 70 - (n - n0) then 'ok' else 'FAIL' end) || E'\n';

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('render', v_msg, '/ [prices]');
  reset role;
  select occurrences into v_occ from client_errors where message = v_msg and kind = 'render';
  r := r || format('C20 an error already stored is still counted during a flood: occ=%s (want 4) %s', v_occ, case when v_occ = 4 then 'ok' else 'FAIL' end) || E'\n';

  -- An hour later the hourly limit has reopened (the clock is moved by ageing the rows), so a new kind is stored again.
  update client_errors set first_seen = now() - interval '3 hours' where kind <> 'overflow' and first_seen > now() - interval '1 hour';
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('logged', 'a new kind an hour later', '/later');
  reset role;
  select count(*) into n from client_errors where message = 'a new kind an hour later';
  r := r || format('C20b an hour later a new kind is stored again: rows=%s (want 1) %s', n, case when n = 1 then 'ok' else 'FAIL' end) || E'\n';

  -- ---- the 2,000-row ceiling ------------------------------------------------------------------------------------------------
  -- (the rows above are aged first, so only the ceiling, not the hourly limit, can be what stops the next one)
  update client_errors set first_seen = now() - interval '3 hours' where kind <> 'overflow' and first_seen > now() - interval '1 hour';
  insert into client_errors (fingerprint, kind, message, screen, first_seen, last_seen)
    select 'bulk' || g, 'logged', 'bulk ' || g, '/bulk', now() - interval '2 days', now() - interval '2 days'
      from generate_series(1, greatest(2000 - (select count(*) from client_errors), 0)) g;
  select coalesce(max(occurrences), 0) into v_over0 from client_errors where kind = 'overflow';
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform public.log_client_error('logged', 'brand new after the ceiling', '/late');
  reset role;
  select count(*) into n from client_errors where message = 'brand new after the ceiling';
  select occurrences into v_over1 from client_errors where kind = 'overflow';
  select count(*) into n0 from client_errors;
  r := r || format('C21 at 2,000 rows a new kind is not stored: rows=%s new=%s overflow +%s %s', n0, n, v_over1 - v_over0, case when n = 0 and v_over1 - v_over0 = 1 and n0 = 2000 then 'ok' else 'FAIL' end) || E'\n';

  -- ---- retention -----------------------------------------------------------------------------------------------------------
  insert into client_errors (fingerprint, kind, message, screen, first_seen, last_seen) values
    ('old31', 'logged', 'seen 31 days ago', '/old', now() - interval '40 days', now() - interval '31 days'),
    ('old29', 'logged', 'seen 29 days ago', '/old', now() - interval '40 days', now() - interval '29 days');
  n := public.purge_old_client_errors();
  select count(*) into n0 from client_errors where fingerprint = 'old31';
  select count(*) into v_occ from client_errors where fingerprint = 'old29';
  r := r || format('C22 purge removed %s row(s); the 31-day-old row left=%s (want 0); the 29-day-old row left=%s (want 1) %s', n, n0, v_occ, case when n >= 1 and n0 = 0 and v_occ = 1 then 'ok' else 'FAIL' end) || E'\n';

  -- ---- who may call what ------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.purge_old_client_errors();
    r := r || 'C23 FAIL: a signed-in user ran the purge' || E'\n';
  exception when others then r := r || format('C23 browsers (even an admin) cannot run the purge: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  begin
    perform public.scrub_client_error_text('a', 10);
    r := r || 'C24 FAIL: a signed-in user ran the scrubber' || E'\n';
  exception when others then r := r || format('C24 browsers cannot call the scrubber: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  reset role;
  set local role anon;
  begin
    perform public.purge_old_client_errors();
    r := r || 'C25 FAIL: a signed-out caller ran the purge' || E'\n';
  exception when others then r := r || format('C25 signed OUT cannot run the purge: %s %s', left(sqlerrm, 40), case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  reset role;

  -- ---- the shape of the thing ---------------------------------------------------------------------------------------------------
  select string_agg(column_name, ',' order by ordinal_position) into t from information_schema.columns where table_schema = 'public' and table_name = 'client_errors';
  r := r || format('C26 columns hold nothing about a person: %s %s', t,
    case when t = 'id,fingerprint,kind,message,screen,details,browser,occurrences,signed_in_occurrences,first_seen,last_seen' then 'ok' else 'FAIL' end) || E'\n';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'client_errors' and cmd <> 'SELECT';
  r := r || format('C27 row security on=%s; policies that allow a write=%s (want true, 0) %s',
    (select relrowsecurity from pg_class where oid = 'public.client_errors'::regclass), n,
    case when (select relrowsecurity from pg_class where oid = 'public.client_errors'::regclass) and n = 0 then 'ok' else 'FAIL' end) || E'\n';
  r := r || format('C28 privileges: anon select/insert=%s/%s, signed-in insert/update/delete=%s/%s/%s %s',
    has_table_privilege('anon', 'public.client_errors', 'select'), has_table_privilege('anon', 'public.client_errors', 'insert'),
    has_table_privilege('authenticated', 'public.client_errors', 'insert'), has_table_privilege('authenticated', 'public.client_errors', 'update'), has_table_privilege('authenticated', 'public.client_errors', 'delete'),
    case when not has_table_privilege('anon', 'public.client_errors', 'select') and not has_table_privilege('anon', 'public.client_errors', 'insert')
          and not has_table_privilege('authenticated', 'public.client_errors', 'insert') and not has_table_privilege('authenticated', 'public.client_errors', 'update')
          and not has_table_privilege('authenticated', 'public.client_errors', 'delete') then 'ok' else 'FAIL' end) || E'\n';
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname in ('log_client_error', 'purge_old_client_errors', 'scrub_client_error_text', 'scrub_client_error_screen')
      and p.proconfig is not null and 'search_path=public' = any (p.proconfig);
  r := r || format('C29 all four functions pin search_path=public: %s of 4 %s', n, case when n = 4 then 'ok' else 'FAIL' end) || E'\n';

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select count(*) into n from cron.job where jobname = 'purge-old-client-errors';
    r := r || format('C30 the daily purge is scheduled: jobs=%s (want 1) %s', n, case when n = 1 then 'ok' else 'FAIL' end) || E'\n';
  else
    r := r || 'C30 pg_cron is not installed here, so no job was scheduled (the migration skips it)' || E'\n';
  end if;

  raise exception 'CLIENT ERRORS TEST (rolled back): %', r;
end $$;
