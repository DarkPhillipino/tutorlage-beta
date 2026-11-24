-- Rolled-back test of migration 20261124260000_tutor_photo.sql (PM lines 72 to 74, 24 Nov 2026). NEEDS THE RUNNER (scripts/run-rolled-back-test.mjs, migration plus this file): the last line raises so everything is undone.
-- Made-up people only. The page-on-by-default migration (20261124240000) is already applied on production, so only the photo migration is passed to the runner.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid();
  ca text; cb text; nfail int; nlines int;
  jpg text := 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
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
    select x, z, 'authenticated', 'authenticated', 'ph.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb]) x;
    update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A' where id = any (array[ta, tb]);
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZPH' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb]) x
       where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    update tutor_profiles set is_verified = true where id = any (array[ta, tb]);   -- their pages go on by default
    select code into ca from promo_codes where owner_tutor_id = ta;
    select code into cb from promo_codes where owner_tutor_id = tb;

    r := r || pg_temp.chk('A1', 'no photo row: the page answers with photo null', (public.public_tutor_page(ca)->'photo')::text, 'null');
    insert into tutor_photo (tutor_id, status, photo_data, basis, basis_at, reviewed_by, reviewed_at)
      values (ta, 'approved', jpg, 'supplied by the tutor through the CEO, approved by the company, 24 Nov 2026', now(), 'CEO', now());
    r := r || pg_temp.chk('A2', 'approved photo is on the page answer, for a visitor', pg_temp.run_as(null, 'select (public.public_tutor_page(''' || ca || ''')->>''photo'')'), jpg);
    r := r || pg_temp.chk('A3', 'the other tutor (no row) still has none', (public.public_tutor_page(cb)->'photo')::text, 'null');
    insert into tutor_photo (tutor_id, status, pending_path) values (tb, 'waiting', tb::text || '/photo.jpg');
    r := r || pg_temp.chk('B1', 'a WAITING photo is never shown', (public.public_tutor_page(cb)->'photo')::text, 'null');
    update tutor_photo set status = 'rejected', reject_reason = 'other_people' where tutor_id = tb;
    r := r || pg_temp.chk('B2', 'a REJECTED photo is never shown', (public.public_tutor_page(cb)->'photo')::text, 'null');
    perform pg_temp.run_as(ta, 'select public.set_my_public_profile(false)::text');
    r := r || pg_temp.chk('C1', 'switching her page off hides the photo at once (no page answer at all)', coalesce(public.public_tutor_page(ca)::text, 'null'), 'null');
    perform pg_temp.run_as(ta, 'select public.set_my_public_profile(true)::text');
    r := r || pg_temp.chk('C2', 'switching her page on again brings the approved photo back', coalesce(public.public_tutor_page(ca)->>'photo', 'null'), jpg);
    r := r || pg_temp.chk('D1', 'nobody can read or write the table from the app (rights held by anon, signed-in, public)', (select count(*) from information_schema.role_table_grants where table_name = 'tutor_photo' and table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC'))::text, '0');
    r := r || pg_temp.chk('D2', 'a signed-in tutor reading the table is refused', substr(pg_temp.run_as(ta, 'select count(*)::text from public.tutor_photo'), 1, 4), 'ERR:');
    begin
      insert into tutor_photo (tutor_id, status, photo_data) values (gen_random_uuid(), 'approved', 'https://x.test/a.jpg');
      r := r || E'E2 FAIL: a web address was accepted as a photo\n';
    exception when others then r := r || E'E2 a web address is refused as a photo: ok\n'; end;
    begin
      update tutor_photo set status = 'approved', photo_data = null where tutor_id = tb;
      r := r || E'E3 FAIL: approved with no picture was accepted\n';
    exception when others then r := r || E'E3 approved with no picture is refused: ok\n'; end;
    r := r || pg_temp.chk('F1', 'the function is still callable by anon and signed-in', has_function_privilege('anon', 'public.public_tutor_page(text)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.public_tutor_page(text)', 'execute')::text, 'true/true');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
