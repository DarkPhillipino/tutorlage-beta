-- Rolled-back test of migration 20261124250000_weekly_post.sql (JOB WEEKLY, 24 Nov 2026). NEEDS THE RUNNER (scripts/run-rolled-back-test.mjs, migration plus this file): the last line raises so everything is undone.
-- Made-up people only. Run it TOGETHER with migration 20261124240000_public_page_on_by_default.sql (the page rows and basis_at come from it).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); tc uuid := gen_random_uuid(); lrn uuid := gen_random_uuid();
  j jsonb; n int; nfail int; nlines int;
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
    select x, z, 'authenticated', 'authenticated', 'wk.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb, tc]) x;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (lrn, z, 'authenticated', 'authenticated', 'wk.l.' || lrn || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}');
    update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A' where id = any (array[ta, tb, tc]);
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZWK' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb, tc]) x
       where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    -- ta and tb are verified (page goes on by default); tc stays unverified; then tb switches her page off
    update tutor_profiles set is_verified = true where id = any (array[ta, tb]);
    perform pg_temp.run_as(tb, 'select public.set_my_public_profile(false)::text');
    -- go live 15 days ago for ta, to test the week number
    update tutor_public_profile set basis_at = now() - interval '15 days' where tutor_id = ta;

    r := r || pg_temp.chk('A1', 'zero lessons so far: week 3 (15 days live), 0 lessons', pg_temp.run_as(ta, 'select public.my_weekly_post()::text'), '{"week": 3, "lessons": 0}');
    -- lessons: 2 completed in the last week, 1 completed 10 days ago, 1 scheduled for tomorrow, 1 cancelled
    insert into sessions (student_id, tutor_id, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, scheduled_start, status, completed_at) values
      (lrn, ta, 100, 20, 100, 80, now() - interval '2 days', 'completed', now() - interval '2 days'),
      (lrn, ta, 100, 20, 100, 80, now() - interval '5 days', 'completed', now() - interval '5 days'),
      (lrn, ta, 100, 20, 100, 80, now() - interval '10 days', 'completed', now() - interval '10 days'),
      (lrn, ta, 100, 20, 100, 80, now() + interval '1 day', 'scheduled', null),
      (lrn, ta, 100, 20, 100, 80, now() - interval '1 day', 'cancelled_by_student', null);
    r := r || pg_temp.chk('B1', 'only lessons COMPLETED in the last 7 days count (not scheduled, cancelled or older)', pg_temp.run_as(ta, 'select public.my_weekly_post()::text'), '{"week": 3, "lessons": 2}');
    r := r || pg_temp.chk('B2', 'the answer holds only the week and the number (no learner, family, price or money)', (select count(*) from jsonb_object_keys((pg_temp.run_as(ta, 'select public.my_weekly_post()::text'))::jsonb))::text, '2');
    r := r || pg_temp.chk('B3', 'a tutor whose page is off gets nothing', pg_temp.run_as(tb, 'select coalesce(public.my_weekly_post()::text, ''null'')'), 'null');
    r := r || pg_temp.chk('B4', 'a tutor not verified, a learner, and a visitor get nothing or are refused', pg_temp.run_as(tc, 'select coalesce(public.my_weekly_post()::text, ''null'')') || '/' || pg_temp.run_as(lrn, 'select coalesce(public.my_weekly_post()::text, ''null'')') || '/' || left(pg_temp.run_as(null, 'select public.my_weekly_post()::text'), 30), 'null/null/ERR: permission denied for fun');

    -- C. the Monday notice: only for a tutor whose page is on, once
    n := public.send_weekly_post_notices();
    r := r || pg_temp.chk('C1', 'a notice for the tutor whose page is on, none for page off or unverified', (select count(*) from notifications where profile_id = ta and type = 'weekly_post_ready')::text || '/' || (select count(*) from notifications where profile_id = tb and type = 'weekly_post_ready')::text || '/' || (select count(*) from notifications where profile_id = tc and type = 'weekly_post_ready')::text, '1/0/0');
    perform public.send_weekly_post_notices();
    r := r || pg_temp.chk('C2', 'a second run the same week does not double it', (select count(*) from notifications where profile_id = ta and type = 'weekly_post_ready')::text, '1');
    r := r || pg_temp.chk('C3', 'the notice words', (select title || ' | ' || body from notifications where profile_id = ta and type = 'weekly_post_ready'), 'Your weekly post is ready | Your weekly post is ready: tap to share.');
    r := r || pg_temp.chk('C4', 'the sender is not callable by the app', has_function_privilege('authenticated', 'public.send_weekly_post_notices()', 'execute')::text || '/' || has_function_privilege('anon', 'public.send_weekly_post_notices()', 'execute')::text, 'false/false');
    r := r || pg_temp.chk('C5', 'the job is scheduled Monday 06:00 UTC (08:00 South African time)', (select schedule from cron.job where jobname = 'weekly-post-notice'), '0 6 * * 1');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
