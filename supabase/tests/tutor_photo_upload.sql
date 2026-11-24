-- RUN THROUGH THE ROLLED-BACK RUNNER WITH THE MIGRATION (never bare on production; PM line 57):
--   node scripts/run-rolled-back-test.mjs out.sql supabase/tests/tutor_photo_upload.sql supabase/migrations/20261125110000_tutor_photo_upload.sql
-- Rolled-back test of migration 20261125110000_tutor_photo_upload.sql (RUN 7, 24 Nov 2026): the tutor's own photo upload stays PENDING and changes nothing public. The last line raises so everything is undone. Made-up people only.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); stu uuid := gen_random_uuid();
  ca text; nfail int; nlines int;
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
    select x, z, 'authenticated', 'authenticated', 'pu.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb]) x;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (stu, z, 'authenticated', 'authenticated', 'pu.s.' || stu || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}');
    update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A' where id = any (array[ta, tb]);
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZPU' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb]) x
       where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    update tutor_profiles set is_verified = true where id = any (array[ta, tb]);
    select code into ca from promo_codes where owner_tutor_id = ta;

    -- A. the bucket
    r := r || pg_temp.chk('A1', 'the bucket is private, 2 MB, three picture types', (select (not public)::text || '/' || file_size_limit || '/' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'tutor-photos'), 'true/2097152/image/jpeg,image/png,image/webp');

    -- B. who may put a file where
    r := r || pg_temp.chk('B1', 'a tutor adds a file in her own folder', pg_temp.run_as(ta, format('insert into storage.objects (bucket_id, name) values (''tutor-photos'', %L) returning name', ta::text || '/pending.jpg')), ta::text || '/pending.jpg');
    r := r || pg_temp.chk('B2', 'a tutor cannot add a file in another tutor''s folder', left(pg_temp.run_as(ta, format('insert into storage.objects (bucket_id, name) values (''tutor-photos'', %L) returning name', tb::text || '/pending.jpg')), 4), 'ERR:');
    r := r || pg_temp.chk('B3', 'a learner cannot add a file, even in a folder with her own id', left(pg_temp.run_as(stu, format('insert into storage.objects (bucket_id, name) values (''tutor-photos'', %L) returning name', stu::text || '/pending.jpg')), 4), 'ERR:');
    r := r || pg_temp.chk('B4', 'a signed-out visitor cannot add a file', left(pg_temp.run_as(null, format('insert into storage.objects (bucket_id, name) values (''tutor-photos'', %L) returning name', ta::text || '/x.jpg')), 4), 'ERR:');
    r := r || pg_temp.chk('B5', 'another tutor cannot see her file', pg_temp.run_as(tb, 'select count(*)::text from storage.objects where bucket_id = ''tutor-photos'''), '0');
    r := r || pg_temp.chk('B6', 'a signed-out visitor sees no file', pg_temp.run_as(null, 'select count(*)::text from storage.objects where bucket_id = ''tutor-photos'''), '0');
    r := r || pg_temp.chk('B7', 'she sees her own file', pg_temp.run_as(ta, 'select count(*)::text from storage.objects where bucket_id = ''tutor-photos'''), '1');

    -- C. submitting: pending only
    r := r || pg_temp.chk('C1', 'before anything: she has no photo and nothing waiting', pg_temp.run_as(ta, 'select (public.my_photo() ->> ''pending'') || ''/'' || coalesce(public.my_photo() ->> ''approved'', ''none'')'), 'false/none');
    r := r || pg_temp.chk('C2', 'a learner is told not a tutor', pg_temp.run_as(stu, 'select (public.my_photo() ->> ''is_tutor'')'), 'false');
    r := r || pg_temp.chk('C3', 'a learner cannot submit', pg_temp.run_as(stu, format('select public.submit_my_photo(%L)', stu::text || '/pending.jpg')), 'ERR: Only tutors can add a photo');
    r := r || pg_temp.chk('C4', 'a signed-out visitor cannot call it', left(pg_temp.run_as(null, 'select public.submit_my_photo(''x'')'), 30), 'ERR: permission denied for fun');
    r := r || pg_temp.chk('C5', 'a path in someone else''s folder is refused', pg_temp.run_as(ta, format('select public.submit_my_photo(%L)', tb::text || '/pending.jpg')), 'ERR: That is not your photo file');
    r := r || pg_temp.chk('C6', 'a path with another name is refused', pg_temp.run_as(ta, format('select public.submit_my_photo(%L)', ta::text || '/other.jpg')), 'ERR: That is not your photo file');
    r := r || pg_temp.chk('C7', 'tutor B has no file, so her submit is refused', pg_temp.run_as(tb, format('select public.submit_my_photo(%L)', tb::text || '/pending.jpg')), 'ERR: The photo file was not found. Please try again.');
    perform pg_temp.run_as(ta, format('select public.submit_my_photo(%L)', ta::text || '/pending.jpg'));
    r := r || pg_temp.chk('C8', 'she submits: it is waiting', pg_temp.run_as(ta, 'select (public.my_photo() ->> ''pending'')'), 'true');
    r := r || pg_temp.chk('C9', 'the public page shows NO photo (pending has no public effect)', coalesce(public.public_tutor_page(ca)->>'photo', 'null'), 'null');
    r := r || pg_temp.chk('C10', 'nobody can read the table from the app', substr(pg_temp.run_as(ta, 'select count(*)::text from public.tutor_photo'), 1, 4), 'ERR:');

    -- D. replacing while an approved photo exists: the OLD approved photo keeps showing
    update tutor_photo set status = 'approved', photo_data = jpg, basis = 'test basis', basis_at = now(), reviewed_by = 'test', reviewed_at = now() where tutor_id = ta;
    r := r || pg_temp.chk('D1', 'with an approved photo the page shows it', public.public_tutor_page(ca)->>'photo', jpg);
    perform pg_temp.run_as(ta, format('select public.submit_my_photo(%L)', ta::text || '/pending.jpg'));
    r := r || pg_temp.chk('D2', 'a replacement is pending and the page STILL shows the old approved photo', (public.public_tutor_page(ca)->>'photo') || '/' || (select status from tutor_photo where tutor_id = ta), jpg || '/approved');
    r := r || pg_temp.chk('D3', 'she sees her approved photo and that a new one waits', pg_temp.run_as(ta, 'select (public.my_photo() ->> ''approved'') || ''/'' || (public.my_photo() ->> ''pending'')'), jpg || '/true');

    -- E. removing
    r := r || pg_temp.chk('E1', 'a learner cannot remove', pg_temp.run_as(stu, 'select public.remove_my_photo()'), 'ERR: Only tutors can remove a photo');
    perform pg_temp.run_as(tb, 'select public.remove_my_photo()');
    r := r || pg_temp.chk('E2', 'another tutor''s removal changes nothing of hers', public.public_tutor_page(ca)->>'photo', jpg);
    perform pg_temp.run_as(ta, 'select public.remove_my_photo()');
    r := r || pg_temp.chk('E3', 'she removes it: the page shows no photo at once', coalesce(public.public_tutor_page(ca)->>'photo', 'null'), 'null');
    r := r || pg_temp.chk('E4', 'and nothing is waiting or approved', pg_temp.run_as(ta, 'select (public.my_photo() ->> ''pending'') || ''/'' || coalesce(public.my_photo() ->> ''approved'', ''none'')'), 'false/none');
    r := r || pg_temp.chk('E5', 'the delete rule exists for her own folder (storage forbids deleting by SQL; the browser deletes through the Storage API)', (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Tutors remove own photo' and cmd = 'DELETE'), '1');

    -- F. rights
    r := r || pg_temp.chk('F1', 'the three functions are for signed-in users only', (has_function_privilege('anon', 'public.my_photo()', 'execute') or has_function_privilege('anon', 'public.submit_my_photo(text)', 'execute') or has_function_privilege('anon', 'public.remove_my_photo()', 'execute'))::text || '/' || (has_function_privilege('authenticated', 'public.my_photo()', 'execute') and has_function_privilege('authenticated', 'public.submit_my_photo(text)', 'execute') and has_function_privilege('authenticated', 'public.remove_my_photo()', 'execute'))::text, 'false/true');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
