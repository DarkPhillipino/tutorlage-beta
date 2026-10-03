-- Read-only fingerprint of everything that decides who can do what. Run it (execute_sql) on dev
-- (wfpjoxetbprmllqqarwp) and on production (qxzhqylrrspumvguflwj) and compare the rows. Matching
-- hashes mean the dev test results carry over to production; a differing hash says where to look.
-- Changes nothing, so it needs no approval. Added 2026-09-30 (backlog 7x).
--
-- Function bodies are compared with Windows line endings and whole-line `--` comments removed (some
-- dev functions were created from files with CRLF endings or extra comments; the logic is the same).
-- Execute rights are compared as what anon and authenticated can actually do, so "default" (PUBLIC)
-- and an explicit grant list that means the same thing compare equal.
-- Known, accepted difference: service_role has broader grants on production (Supabase's defaults);
-- it is excluded here. All seven rows matched on 2026-09-30 after 20260930235000.
-- 2026-10-01, after 20260930239600 on both: six rows match; function_bodies differs only because dev's
-- record_card_verification lacks one end-of-line comment ("-- already recorded; repeat calls change
-- nothing") that production has from the file. Same logic; known and accepted.
with f as (
  select p.oid::regprocedure::text as sig,
         md5(regexp_replace(replace(pg_get_functiondef(p.oid), E'\r', ''), '^[ \t]*--[^\n]*\n', '', 'gn')) as h,
         has_function_privilege('anon', p.oid, 'EXECUTE')::text || '/'
           || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
), pol as (
  select schemaname||'.'||tablename||':'||policyname
         ||md5(coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||cmd||'|'||array_to_string(roles,',')||'|'||permissive) as k
  from pg_policies where schemaname in ('public','storage')
), tg as (
  select table_name||':'||grantee||':'||privilege_type as k from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon','authenticated')
), cg as (
  select table_name||'.'||column_name||':'||grantee||':'||privilege_type as k from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon','authenticated')
), trg as (
  select event_object_schema||'.'||event_object_table||':'||trigger_name||':'||event_manipulation||':'||md5(action_statement) as k
  from information_schema.triggers where event_object_schema in ('public','auth')
), dacl as (
  select defaclobjtype::text||':'||coalesce(array_to_string(array(
           select a from unnest(defaclacl) a where a::text !~ '^service_role='), ','), '') as k
  from pg_default_acl where defaclnamespace = 'public'::regnamespace and pg_get_userbyid(defaclrole) = 'postgres'
)
select 'function_bodies' as what, count(*)::text as n, md5(string_agg(sig||h, ';' order by sig)) as hash from f
union all select 'function_execute', count(*)::text, md5(string_agg(sig||acl, ';' order by sig)) from f
union all select 'policies', count(*)::text, md5(string_agg(k, ';' order by k)) from pol
union all select 'table_grants', count(*)::text, md5(string_agg(k, ';' order by k)) from tg
union all select 'column_grants', count(*)::text, md5(string_agg(k, ';' order by k)) from cg
union all select 'triggers', count(*)::text, md5(string_agg(k, ';' order by k)) from trg
union all select 'default_privileges', count(*)::text, md5(string_agg(k, ';' order by k)) from dacl;
