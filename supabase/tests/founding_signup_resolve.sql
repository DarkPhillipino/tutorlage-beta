-- Rolled-back test of migration 20261118210000_signup_link_confirms.sql (job T, 18 Nov 2026): the database half of "a valid personal link makes the tutor account already confirmed".
-- founding_signup_resolve answers only for a complete, released, unlapsed row that has no account, only while the setting signup_link_confirms is on, it counts misses per caller and for everybody,
-- it writes nothing on a hit, and only the server key may call it. Made-up people only (example.invalid); the block ends with `raise exception` so nothing is kept.
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/founding_signup_resolve.sql supabase/migrations/20261118210000_signup_link_confirms.sql
-- After the apply, paste this file alone.
do $$
declare
  r text := '';
  uid text := replace(gen_random_uuid()::text, '-', '');
  adult text := ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text;
  minor text := ((now() at time zone 'Africa/Johannesburg')::date - interval '15 years')::date::text;
  ra uuid; rb uuid; rc uuid; rd uuid; re_ uuid; rf uuid; rg uuid; rh uuid; ri uuid; rj uuid;
  ta text; tb text;
  j jsonb; n_before int; n_after int; setting_before jsonb; n_events_before bigint;
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    -- a list row: status, messaged-days-ago (null = never marked), first name, surname, date of birth (text or null), phone, source
    execute $mk$
      create function pg_temp.mkrow(p_tag text, p_email text, p_status text, p_msg_days int, p_first text, p_surname text, p_dob text, p_phone text, p_source text) returns uuid language plpgsql as $f$
      declare v uuid;
      begin
        insert into public.founding_tutors_list (source, full_name, first_name, surname, date_of_birth, code_name, whatsapp, email, email_key, src, status, released_at, released_messaged_at, subjects)
        values (p_source, coalesce(p_first, 'Zz') || ' ' || coalesce(p_surname, 'Zz'), p_first, p_surname, nullif(p_dob, '')::date, 'Zz', p_phone, p_email, lower(p_email), p_tag, p_status,
                case when p_status = 'released' then now() end,
                case when p_msg_days is not null then now() - make_interval(days => p_msg_days) end,
                '[{"subject": "Mathematics", "min_grade": "Grade 8", "max_grade": "Grade 12"}]'::jsonb)
        returning id into v;
        return v;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.tok(p_id uuid) returns text language sql as $f$ select signup_token from public.founding_tutors_list where id = p_id $f$ $mk$;

    setting_before := (select setting_value from public.system_settings where setting_key = 'signup_link_confirms');
    r := r || pg_temp.chk('S1', 'the setting exists and is OFF by default', (setting_before ->> 'on'), 'false');

    -- A: a good row (released, messaged 3 days ago, complete). B: still "joined". C: lapsed (messaged 20 days ago). D: account exists (an Auth user has the email). E: no surname. F: no date of birth.
    -- G: under 18. H: backfill row. I: released and never marked as messaged (the clock has not started: still good). J: a good row for the caller-limit test.
    ra := pg_temp.mkrow('zzt-a-' || uid, 'zt.a.' || uid || '@Example.invalid', 'released', 3, 'Zanele', 'Zulu', adult, '+27820000011', 'form');
    rb := pg_temp.mkrow('zzt-b-' || uid, 'zt.b.' || uid || '@example.invalid', 'joined', null, 'Zb', 'Zb', adult, '+27820000012', 'form');
    rc := pg_temp.mkrow('zzt-c-' || uid, 'zt.c.' || uid || '@example.invalid', 'released', 20, 'Zc', 'Zc', adult, '+27820000013', 'form');
    rd := pg_temp.mkrow('zzt-d-' || uid, 'zt.d.' || uid || '@example.invalid', 'released', 3, 'Zd', 'Zd', adult, '+27820000014', 'form');
    re_ := pg_temp.mkrow('zzt-e-' || uid, 'zt.e.' || uid || '@example.invalid', 'released', 3, 'Ze', null, adult, '+27820000015', 'form');
    rf := pg_temp.mkrow('zzt-f-' || uid, 'zt.f.' || uid || '@example.invalid', 'released', 3, 'Zf', 'Zf', null, '+27820000016', 'form');
    rg := pg_temp.mkrow('zzt-g-' || uid, 'zt.g.' || uid || '@example.invalid', 'released', 3, 'Zg', 'Zg', minor, '+27820000017', 'form');
    rh := pg_temp.mkrow('zzt-h-' || uid, 'zt.h.' || uid || '@example.invalid', 'released', 3, 'Zh', 'Zh', adult, '+27820000018', 'form');
    ri := pg_temp.mkrow('zzt-i-' || uid, 'zt.i.' || uid || '@example.invalid', 'released', null, 'Zi', 'Zi', adult, '', 'admin');
    rj := pg_temp.mkrow('zzt-j-' || uid, 'zt.j.' || uid || '@example.invalid', 'released', 3, 'Zj', 'Zj', adult, '082 000 0019', 'form');
    -- H becomes a backfill-style source by an update that the check constraint allows only with the fields set; here it is left a form row but linked to an account id later (see below)
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zt.d.' || uid || '@example.invalid', '{}', '{}');
    -- H: the row already has an account link (a person who made one another way)
    update public.founding_tutors_list set status = 'signed_up' where id = rh;

    -- the setting is OFF: everything answers null and nothing is counted
    n_before := (select count(*) from public.founding_signup_lookups);
    r := r || pg_temp.chk('O1', 'switch OFF: a perfectly good link answers null', coalesce(public.founding_signup_resolve(pg_temp.tok(ra), 'zz-caller-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('O2', 'switch OFF: nothing is written to the lookup memory', ((select count(*) from public.founding_signup_lookups) - n_before)::text, '0');

    -- turn it on (inside this rolled-back test only)
    update public.system_settings set setting_value = '{"on": true}'::jsonb where setting_key = 'signup_link_confirms';

    j := public.founding_signup_resolve(pg_temp.tok(ra), 'zz-caller-' || uid);
    r := r || pg_temp.chk('A1', 'a good link answers the row id', (j ->> 'row_id'), ra::text);
    r := r || pg_temp.chk('A2', 'it answers first name, surname, email as on the row, phone as 0..., date of birth', (j ->> 'first_name') || '/' || (j ->> 'surname') || '/' || (j ->> 'email') || '/' || (j ->> 'phone') || '/' || (j ->> 'date_of_birth'),
      'Zanele/Zulu/zt.a.' || uid || '@Example.invalid/0820000011/' || adult);
    r := r || pg_temp.chk('A3', 'it answers nothing else (the six keys only)', (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k), 'date_of_birth,email,first_name,phone,row_id,surname');
    r := r || pg_temp.chk('A4', 'an upper-case token works', (public.founding_signup_resolve(upper(pg_temp.tok(ra)), 'zz-caller-' || uid) ->> 'row_id'), ra::text);
    r := r || pg_temp.chk('A5', 'a token with spaces around it works', (public.founding_signup_resolve('  ' || pg_temp.tok(ra) || ' ', 'zz-caller-' || uid) ->> 'row_id'), ra::text);
    r := r || pg_temp.chk('A6', 'released and never marked as messaged (no phone on the row): the clock has not started, still good, phone null', coalesce(public.founding_signup_resolve(pg_temp.tok(ri), 'zz-caller-' || uid) ->> 'phone', 'null') || '/' || (public.founding_signup_resolve(pg_temp.tok(ri), 'zz-caller-' || uid) ->> 'row_id' = ri::text)::text, 'null/true');
    r := r || pg_temp.chk('A7', 'a phone written 082 000 0019 is not a valid +27 number on the row: no phone, the rest still answers', coalesce(public.founding_signup_resolve(pg_temp.tok(rj), 'zz-caller-' || uid) ->> 'phone', 'null') || '/' || (public.founding_signup_resolve(pg_temp.tok(rj), 'zz-caller-' || uid) ->> 'first_name'), 'null/Zj');

    n_before := (select count(*) from public.founding_signup_lookups);
    r := r || pg_temp.chk('H1', 'a hit writes nothing to the lookup memory', ((select count(*) from public.founding_signup_lookups) - n_before)::text, '0');
    r := r || pg_temp.chk('H2', 'a hit changes nothing on the list row (status, user, dates)',
      (select (f.status = 'released' and f.user_id is null and f.released_messaged_at is not null)::text from public.founding_tutors_list f where f.id = ra), 'true');

    -- the refusals, each answering null
    r := r || pg_temp.chk('R1', 'unknown token', coalesce(public.founding_signup_resolve(replace(gen_random_uuid()::text, '-', ''), 'zz-r1-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R2', 'a token of the wrong shape', coalesce(public.founding_signup_resolve('not-a-token', 'zz-r2-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R3', 'null token', coalesce(public.founding_signup_resolve(null, 'zz-r3-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R4', 'a row still "joined" (place not open)', coalesce(public.founding_signup_resolve(pg_temp.tok(rb), 'zz-r4-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R5', 'a lapsed release (messaged 20 days ago, window 14)', coalesce(public.founding_signup_resolve(pg_temp.tok(rc), 'zz-r5-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R6', 'an account already exists with the row''s email (the link works once)', coalesce(public.founding_signup_resolve(pg_temp.tok(rd), 'zz-r6-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R7', 'a row without a surname', coalesce(public.founding_signup_resolve(pg_temp.tok(re_), 'zz-r7-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R8', 'a row without a date of birth', coalesce(public.founding_signup_resolve(pg_temp.tok(rf), 'zz-r8-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R9', 'a row under 18', coalesce(public.founding_signup_resolve(pg_temp.tok(rg), 'zz-r9-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('R10', 'a row that has already signed up (status signed_up)', coalesce(public.founding_signup_resolve(pg_temp.tok(rh), 'zz-r10-' || uid)::text, 'null'), 'null');
    update public.system_settings set setting_value = '30'::jsonb where setting_key = 'founding_release_lapse_days';
    r := r || pg_temp.chk('R11', 'the lapse window follows the setting: window 30 days makes the 20-day row good again',
      (public.founding_signup_resolve(pg_temp.tok(rc), 'zz-r11-' || uid) ->> 'row_id' = rc::text)::text, 'true');
    update public.system_settings set setting_value = '14'::jsonb where setting_key = 'founding_release_lapse_days';

    -- a row that links to an account through user_id (without the same email) is refused too
    update public.founding_tutors_list set user_id = (select p.id from public.profiles p where not exists (select 1 from public.founding_tutors_list x where x.user_id = p.id) limit 1) where id = rj;
    r := r || pg_temp.chk('R12', 'a row with a user link is refused (when any profile exists to link to)',
      case when (select user_id from public.founding_tutors_list where id = rj) is not null then coalesce(public.founding_signup_resolve(pg_temp.tok(rj), 'zz-r12-' || uid)::text, 'null') else 'null' end, 'null');

    -- the miss counter: only misses are written, per caller first
    n_before := (select count(*) from public.founding_signup_lookups where bucket = 'w:zz-rl-' || uid);
    for i in 1..10 loop perform public.founding_signup_resolve(replace(gen_random_uuid()::text, '-', ''), 'zz-rl-' || uid); end loop;
    n_after := (select count(*) from public.founding_signup_lookups where bucket = 'w:zz-rl-' || uid);
    r := r || pg_temp.chk('L1', 'ten misses by one caller are written under that caller', (n_after - n_before)::text, '10');
    r := r || pg_temp.chk('L2', 'the eleventh call by that caller answers null even for a good link', coalesce(public.founding_signup_resolve(pg_temp.tok(ra), 'zz-rl-' || uid)::text, 'null'), 'null');
    r := r || pg_temp.chk('L3', 'another caller is not affected and gets the answer', (public.founding_signup_resolve(pg_temp.tok(ra), 'zz-other-' || uid) ->> 'row_id'), ra::text);
    r := r || pg_temp.chk('L4', 'the blocked call wrote no further miss', (select count(*)::text from public.founding_signup_lookups where bucket = 'w:zz-rl-' || uid), '10');
    r := r || pg_temp.chk('L5', 'no caller given is one shared "unknown" bucket (still answers)', (public.founding_signup_resolve(pg_temp.tok(ra), null) ->> 'row_id'), ra::text);

    -- the global line (300 misses in 10 minutes for everybody) switches the whole thing to null, then clears
    insert into public.founding_signup_lookups (bucket) select 'w:zz-glob-' || (g % 40) from generate_series(1, 300) g;
    r := r || pg_temp.chk('G1', 'after 300 misses in 10 minutes for everybody, a good link answers null', coalesce(public.founding_signup_resolve(pg_temp.tok(ra), 'zz-fresh-' || uid)::text, 'null'), 'null');
    delete from public.founding_signup_lookups where bucket like 'w:zz-glob-%';
    r := r || pg_temp.chk('G2', 'and answers again once the window has cleared', (public.founding_signup_resolve(pg_temp.tok(ra), 'zz-fresh-' || uid) ->> 'row_id'), ra::text);

    -- the switch back off is instant
    update public.system_settings set setting_value = '{"on": false}'::jsonb where setting_key = 'signup_link_confirms';
    r := r || pg_temp.chk('O3', 'switch back OFF: the same good link answers null', coalesce(public.founding_signup_resolve(pg_temp.tok(ra), 'zz-fresh-' || uid)::text, 'null'), 'null');

    -- who may call it, and what was not touched
    r := r || pg_temp.chk('X1', 'only the server key may call it (anon / signed in / service)',
      has_function_privilege('anon', 'public.founding_signup_resolve(text, text)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.founding_signup_resolve(text, text)', 'execute')::text || '/' ||
      has_function_privilege('service_role', 'public.founding_signup_resolve(text, text)', 'execute')::text, 'false/false/true');
    r := r || pg_temp.chk('X2', 'the anon pre-fill is unchanged: still granted to anon, still answers the same row (it does not read the switch)',
      has_function_privilege('anon', 'public.founding_signup_prefill(text)', 'execute')::text || '/' || (public.founding_signup_prefill(pg_temp.tok(ra)) ->> 'first_name'), 'true/Zanele');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
