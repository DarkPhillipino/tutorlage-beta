-- Tidy of rights nothing uses (production review 20 Oct 2026: m2 and m4). Takes rights away only; no table, column, policy or data changes.
--   m2  signed-out and signed-in users (anon, authenticated) held TRUNCATE, REFERENCES, TRIGGER and (Postgres 17) MAINTAIN on every
--       table in public, from Supabase's default privileges. The app never uses them (rows are read and written through SELECT, INSERT,
--       UPDATE and DELETE only). They are removed from every existing table and from the defaults, so tables created later do not get them.
--       service_role keeps its defaults (the server's key). The wider INSERT/UPDATE/DELETE rights on admin-only tables stay: the admin app
--       needs them and a row-level policy is the fence (a regression probe for that is in the test).
--   m4  eight trigger functions in public were executable by signed-out users. A trigger function cannot be called through the API and
--       a trigger does not need the caller to hold EXECUTE, so nothing changes in use; the rights are removed so the advisor and a
--       reader see no open door. is_plausible_date_of_birth() (a harmless helper that other functions call) is left as it is.
-- m3 (pg_net open to the API roles) is NOT here: the grants were made by supabase_admin, so this role cannot take them back.

do $$
declare
  v_privs text := 'truncate, references, trigger';
begin
  if current_setting('server_version_num')::int >= 170000 then
    v_privs := v_privs || ', maintain';
  end if;
  execute format('revoke %s on all tables in schema public from anon, authenticated', v_privs);
  execute format('alter default privileges for role postgres in schema public revoke %s on tables from anon, authenticated', v_privs);
end $$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype = 'trigger'::regtype
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
