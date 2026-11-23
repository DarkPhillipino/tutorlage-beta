-- Rolled-back test of migration 20261124140000_views_security_invoker.sql (job U1, 24 Nov 2026). Run it TOGETHER with the migration, or alone after the apply. Read-only catalog checks; nothing is kept.
do $$
declare
  r text := '';
  n int; nlines int; nfail int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('v', 'm') and not coalesce((select o.option_value = 'true' from pg_options_to_table(c.reloptions) o where o.option_name = 'security_invoker'), false);
  r := r || 'V1 views in schema public without security_invoker: ' || n || case when n = 0 then ' ok' else ' FAIL (want 0)' end || E'\n';
  select count(*) into n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('founding_tutor_facts', 'founding_person_steps') and c.relkind = 'v';
  r := r || 'V2 both founding views exist: ' || n || case when n = 2 then ' ok' else ' FAIL (want 2)' end || E'\n';
  select count(*) into n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('service_role', c.oid, 'select'));
  r := r || 'V3 views any API role can read: ' || n || case when n = 0 then ' ok' else ' FAIL (want 0; if a view was opened on purpose, list it here)' end || E'\n';
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and (pg_get_functiondef(p.oid) like '%founding_tutor_facts%' or pg_get_functiondef(p.oid) like '%founding_person_steps%') and not p.prosecdef;
  r := r || 'V4 functions that read the founding views and are NOT security definer: ' || n || case when n = 0 then ' ok' else ' FAIL (want 0)' end || E'\n';
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL\n%', nlines, nfail, r;
end $$;
