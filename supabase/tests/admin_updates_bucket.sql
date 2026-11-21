-- Rolled-back test of migration 20261119000000_admin_updates_bucket.sql (J2, 19 Nov 2026): the private feed for the self-updating admin app.
-- Proves: the bucket exists and is PRIVATE with a size limit; one read policy exists, and it is the only policy that mentions the bucket; an ACTIVE admin reads a
-- made-up object in it; a deactivated admin, a signed-in tutor and a signed-out visitor read nothing and cannot list it; nobody over the API can write, change or
-- delete in it (no policy); the other buckets still have exactly the policies they had. Made-up people only (example.invalid); the block ends with `raise
-- exception` so nothing is kept (the made-up object, the people and, when run with the migration, the bucket go with it).
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/admin_updates_bucket.sql supabase/migrations/20261119000000_admin_updates_bucket.sql
-- After the apply, paste this file alone.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ad uuid := gen_random_uuid();   -- an active admin
  off uuid := gen_random_uuid();  -- an admin who was switched off
  tu uuid := gen_random_uuid();   -- a tutor
  n int; n2 int; s text;
  nfail int; nlines int;
  others_before int := (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and qual not like '%admin-updates%');
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (ad,  z, 'authenticated', 'authenticated', 'aub.ad.'  || ad  || '@example.invalid', jsonb_build_object('first_name', 'Admin', 'date_of_birth', adult), '{}'),
      (off, z, 'authenticated', 'authenticated', 'aub.off.' || off || '@example.invalid', jsonb_build_object('first_name', 'Off',   'date_of_birth', adult), '{}'),
      (tu,  z, 'authenticated', 'authenticated', 'aub.tu.'  || tu  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tutor', 'date_of_birth', adult), '{}');
    insert into public.admin_profiles (id, first_name, surname, email, admin_role) values
      (ad, 'Test', 'Admin', 'aub.ad.' || ad || '@example.invalid', 'super_admin'),
      (off, 'Test', 'Off', 'aub.off.' || off || '@example.invalid', 'super_admin');
    update public.admin_profiles set is_active = false where id = off;
    insert into storage.objects (bucket_id, name) values ('admin-updates', 'manifest.json'), ('admin-updates', 'bundles/1/app-dist.tlb');

    r := r || pg_temp.chk('U1', 'the bucket exists, is private, has a size limit of 80 MB and takes only json and octet-stream',
      (select public::text || ' ' || file_size_limit || ' ' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'admin-updates'),
      'false 83886080 application/json,application/octet-stream');
    r := r || pg_temp.chk('U2', 'exactly one policy mentions the bucket: a SELECT for signed-in users',
      (select count(*)::text || ' ' || coalesce(string_agg(cmd || '/' || array_to_string(roles, ','), ','), '') from pg_policies where schemaname = 'storage' and tablename = 'objects' and qual like '%admin-updates%'),
      '1 SELECT/authenticated');
    r := r || pg_temp.chk('U3', 'that policy asks for an active admin', (select (qual like '%is_active_admin()%')::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Active admins read admin updates'), 'true');

    -- an active admin reads both objects, and lists them
    perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from storage.objects where bucket_id = 'admin-updates';
    reset role;
    r := r || pg_temp.chk('U4', 'an active admin sees both objects', n::text, '2');

    -- a switched-off admin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', off, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from storage.objects where bucket_id = 'admin-updates';
    reset role;
    r := r || pg_temp.chk('U5', 'an admin who was switched off sees nothing', n::text, '0');

    -- a signed-in tutor
    perform set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from storage.objects where bucket_id = 'admin-updates';
    reset role;
    r := r || pg_temp.chk('U6', 'a signed-in tutor sees nothing', n::text, '0');

    -- a signed-out visitor
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    select count(*) into n from storage.objects where bucket_id = 'admin-updates';
    reset role;
    r := r || pg_temp.chk('U7', 'a signed-out visitor sees nothing', n::text, '0');

    -- nobody can write through the API, not even an active admin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into storage.objects (bucket_id, name) values ('admin-updates', 'bundles/2/evil.tlb'); s := 'INSERTED';
    exception when others then s := 'refused'; end;
    begin
      update storage.objects set name = 'manifest.json.bak' where bucket_id = 'admin-updates' and name = 'manifest.json'; get diagnostics n = row_count; s := s || ' updated=' || n;
    exception when others then s := s || ' update refused'; end;
    begin
      delete from storage.objects where bucket_id = 'admin-updates'; get diagnostics n = row_count; s := s || ' deleted=' || n;
    exception when others then s := s || ' delete refused'; end;
    reset role;
    select count(*) into n2 from storage.objects where bucket_id = 'admin-updates';
    r := r || pg_temp.chk('U8', 'an active admin cannot insert, rename or delete (writes are refused or touch 0 rows); both objects are still there',
      case when s like 'refused%' and n2 = 2 and exists (select 1 from storage.objects where bucket_id = 'admin-updates' and name = 'manifest.json') then 'refused / untouched' else s || ' left=' || n2 end, 'refused / untouched');

    r := r || pg_temp.chk('U9', 'the policies on every other bucket are exactly as many as before', (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and qual not like '%admin-updates%'), others_before::text);
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
