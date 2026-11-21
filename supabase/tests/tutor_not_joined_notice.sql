-- Rolled-back test of migration 20261121100000_tutor_not_joined_notice.sql (J1, Start brief 3, 21 Nov 2026): the in-app notice "Your tutor has not joined yet".
-- It proves: the settings exist (switch OFF, 5 minutes); the switch OFF writes nothing; not before N minutes; ONLY for a scheduled session still running,
-- never cancelled, completed, over, or with its own meeting link; never when the tutor was admitted to the room (a tutor only waiting is not joined);
-- the right recipients (learner, plus the booking parent when different, never the tutor); the exact words and type; once only; a moved session is told once for its new time;
-- a bad minutes setting counts as 5; the job is closed to clients; the cron job exists. It checks notices per made-up session, so real rows on the database never matter.
-- Made-up people only (example.invalid); the block ends with `raise exception` so nothing is kept.
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/tutor_not_joined_notice.sql supabase/migrations/20261121100000_tutor_not_joined_notice.sql
-- After the apply, run this file alone.
do $$
declare
  r text := '';
  uid text := replace(gen_random_uuid()::text, '-', '');
  z uuid := '00000000-0000-0000-0000-000000000000';
  vl uuid := gen_random_uuid();  -- learner
  vp uuid := gen_random_uuid();  -- booking parent
  vt uuid := gen_random_uuid();  -- tutor
  sa uuid; sb uuid; sc uuid; sd uuid; se uuid; sf uuid; sg uuid; sh uuid; si uuid; sk uuid;
  rm uuid; n integer; t text; b text; ty text;
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    execute $mk$
      create function pg_temp.mk(p_student uuid, p_tutor uuid, p_booker uuid, p_start timestamptz, p_status text default 'scheduled', p_url text default null) returns uuid language sql as $f$
        insert into public.sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, status, meeting_url, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
        values (p_student, p_tutor, p_booker, p_start, p_status::public.session_status, p_url, 50, 30, 50, 35) returning id $f$ $mk$;
    execute $mk$
      create function pg_temp.cnt(p_session uuid, p_profile uuid default null) returns text language sql as $f$
        select count(*)::text from public.notifications where type = 'tutor_not_joined' and related_session_id = p_session and (p_profile is null or profile_id = p_profile) $f$ $mk$;
    execute $mk$
      create function pg_temp.room(p_session uuid, p_tutor uuid, p_code text, p_admitted boolean) returns void language sql as $f$
        with rm as (insert into public.video_rooms (code, host_id, session_id, expires_at) values (p_code, p_tutor, p_session, now() + interval '1 day') returning id)
        insert into public.video_room_members (room_id, profile_id, status, admitted_at)
        select rm.id, p_tutor, case when p_admitted then 'admitted' else 'waiting' end, case when p_admitted then now() - interval '5 minutes' else null end from rm $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (vl, z, 'authenticated', 'authenticated', 'nj.l.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Zzlearner', 'date_of_birth', (current_date - interval '30 years')::date::text), '{}'),
      (vp, z, 'authenticated', 'authenticated', 'nj.p.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Zzparent', 'date_of_birth', (current_date - interval '40 years')::date::text), '{}'),
      (vt, z, 'authenticated', 'authenticated', 'nj.t.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zztutor', 'date_of_birth', (current_date - interval '30 years')::date::text), '{}');

    -- A room can only be opened by a verified tutor (migration 20261116190500): mark the made-up tutor verified (rolled back with everything else).
    update public.tutor_profiles set is_verified = true where id = vt;

    r := r || pg_temp.chk('S1', 'settings: switch OFF, 5 minutes',
      (select string_agg(setting_key || '=' || setting_value::text, ',' order by setting_key) from public.system_settings where setting_key in ('notice_tutor_not_joined', 'tutor_not_joined_minutes')),
      'notice_tutor_not_joined=false,tutor_not_joined_minutes=5');

    -- sessions (all one hour long unless said otherwise)
    sa := pg_temp.mk(vl, vt, vp, now() - interval '10 minutes');                         -- main: learner + different parent, tutor absent
    sb := pg_temp.mk(vl, vt, vl, now() - interval '3 minutes');                          -- too early
    sc := pg_temp.mk(vl, vt, vp, now() - interval '10 minutes', 'cancelled_by_tutor');   -- cancelled
    sd := pg_temp.mk(vl, vt, vp, now() - interval '10 minutes', 'completed');            -- completed
    se := pg_temp.mk(vl, vt, vp, now() - interval '10 minutes');                         -- tutor joined
    perform pg_temp.room(se, vt, 'NJTEST22', true);
    sf := pg_temp.mk(vl, vt, vp, now() - interval '10 minutes');                         -- tutor only waiting (never admitted)
    perform pg_temp.room(sf, vt, 'NJTEST23', false);
    sg := pg_temp.mk(vl, vt, vp, now() - interval '90 minutes');                         -- already over
    sh := pg_temp.mk(vl, vt, vp, now() - interval '10 minutes', 'scheduled', 'https://example.invalid/meet'); -- own meeting link
    si := pg_temp.mk(vl, vt, vl, now() - interval '10 minutes');                         -- learner booked it themselves: one recipient

    -- S2 switch OFF writes nothing
    n := public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S2', 'switch OFF: job returns 0', n::text, '0');
    r := r || pg_temp.chk('S2b', 'switch OFF: no notice for any test session', (select count(*)::text from public.notifications where type = 'tutor_not_joined' and related_session_id in (sa, sb, sc, sd, se, sf, sg, sh, si)), '0');

    -- S3 switch ON
    update public.system_settings set setting_value = 'true'::jsonb where setting_key = 'notice_tutor_not_joined';
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S3', 'main session: learner told once', pg_temp.cnt(sa, vl), '1');
    r := r || pg_temp.chk('S3b', 'main session: the different booking parent told once', pg_temp.cnt(sa, vp), '1');
    r := r || pg_temp.chk('S3c', 'main session: the tutor is NOT told', pg_temp.cnt(sa, vt), '0');
    select x.title, x.body, x.type into t, b, ty from public.notifications x where x.related_session_id = sa and x.profile_id = vl and x.type = 'tutor_not_joined';
    r := r || pg_temp.chk('S3d', 'exact type, title and body', ty || '|' || t || '|' || b,
      'tutor_not_joined|Your tutor has not joined yet|Your tutor has not joined your session yet. Please stay on the session page: you can join as soon as they arrive.');
    r := r || pg_temp.chk('S4', 'only 3 minutes after the start: nothing', pg_temp.cnt(sb), '0');
    r := r || pg_temp.chk('S5', 'cancelled session: nothing', pg_temp.cnt(sc), '0');
    r := r || pg_temp.chk('S5b', 'completed session: nothing', pg_temp.cnt(sd), '0');
    r := r || pg_temp.chk('S6', 'tutor admitted to the room: nothing', pg_temp.cnt(se), '0');
    r := r || pg_temp.chk('S6b', 'tutor only waiting in the room (not admitted): told (2 people: learner + parent)', pg_temp.cnt(sf), '2');
    r := r || pg_temp.chk('S7', 'session already over: nothing', pg_temp.cnt(sg), '0');
    r := r || pg_temp.chk('S7b', 'session with its own meeting link: nothing', pg_temp.cnt(sh), '0');
    r := r || pg_temp.chk('S8', 'learner booked it themselves: exactly one notice', pg_temp.cnt(si), '1');

    -- S9 once only
    perform public.notify_tutor_not_joined();
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S9', 'two more runs: main session still 2 notices in all', pg_temp.cnt(sa), '2');
    r := r || pg_temp.chk('S9b', 'the session records the start it was told for', (select (tutor_not_joined_notified_start = scheduled_start)::text from public.sessions where id = sa), 'true');

    -- S10 time passes: the 3-minute session becomes 5 minutes late (moved back in time) and is told once
    update public.sessions set scheduled_start = now() - interval '6 minutes' where id = sb;
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S10', 'the early session, now 6 minutes after its start: told (1 person)', pg_temp.cnt(sb), '1');

    -- S11 a session moved to a new time is told once for the new time
    update public.sessions set scheduled_start = now() - interval '8 minutes' where id = sa;
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S11', 'main session moved to a new start, tutor still absent: told once more (4 in all)', pg_temp.cnt(sa), '4');
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S11b', 'and not again', pg_temp.cnt(sa), '4');

    -- S12 the minutes setting: a bad value counts as 5, a good one moves the line
    sk := pg_temp.mk(vl, vt, vl, now() - interval '3 minutes');
    update public.system_settings set setting_value = '"abc"'::jsonb where setting_key = 'tutor_not_joined_minutes';
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S12', 'setting "abc": counts as 5, a 3-minute-old session is not told', pg_temp.cnt(sk), '0');
    update public.system_settings set setting_value = '0'::jsonb where setting_key = 'tutor_not_joined_minutes';
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S12b', 'setting 0: counts as 5, still not told', pg_temp.cnt(sk), '0');
    update public.system_settings set setting_value = '2'::jsonb where setting_key = 'tutor_not_joined_minutes';
    perform public.notify_tutor_not_joined();
    r := r || pg_temp.chk('S12c', 'setting 2: now told', pg_temp.cnt(sk), '1');
    update public.system_settings set setting_value = '5'::jsonb where setting_key = 'tutor_not_joined_minutes';

    -- S13 switch OFF again: a brand-new late session gets nothing
    update public.system_settings set setting_value = 'false'::jsonb where setting_key = 'notice_tutor_not_joined';
    sk := pg_temp.mk(vl, vt, vp, now() - interval '20 minutes');
    r := r || pg_temp.chk('S13', 'switch OFF again: job returns 0', public.notify_tutor_not_joined()::text, '0');
    r := r || pg_temp.chk('S13b', 'and writes nothing', pg_temp.cnt(sk), '0');

    -- S14 closed to clients
    perform set_config('request.jwt.claims', json_build_object('sub', vl, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.notify_tutor_not_joined();
      r := r || 'S14 FAIL a learner ran the job' || E'\n';
    exception when others then r := r || 'S14 a learner cannot run the job: ' || sqlerrm || ' ok' || E'\n'; end;
    reset role;

    -- S15 the job exists
    r := r || pg_temp.chk('S15', 'cron job notify-tutor-not-joined every 2 minutes',
      coalesce((select j.schedule from cron.job j where j.jobname = 'notify-tutor-not-joined'), 'missing'), '*/2 * * * *');

    nlines := array_length(string_to_array(trim(trailing E'\n' from r), E'\n'), 1);
    nfail := (select count(*) from regexp_matches(r, 'FAIL', 'g'));
    raise exception E'\nTUTOR NOT JOINED NOTICE TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
  end;
end $$;
