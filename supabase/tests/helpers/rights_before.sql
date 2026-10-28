-- Helper for supabase/tests/document_access_log.sql (not a test, not a migration).
-- scripts/run-rolled-back-test.mjs runs this FIRST, before the three migrations and the suite, all in one rolled-back statement, so the suite
-- can prove that the rights tidy (migration 20261021110000) took away only what it said and nothing else. It defines four throwaway helpers
-- in pg_temp (gone at rollback) and notes what they say now in four test settings. The document access log and safety hold tables
-- and their functions are left out of the comparisons: they do not exist yet at this point. The same goes for the hand-over table and the
-- functions of migrations 20261021120000 and 20261021130000 (added 21 Oct, the hold protections and the hand-over export), and the four tables and
-- thirty functions of 20261021140000 (the close-account tool, added 21 Oct). It also notes the
-- text of two functions that migration 20261021120000 must leave alone or replace: supabase/tests/holds_and_handover.sql compares them.
create function pg_temp.rights_hash_dml() returns text language sql as $f$
  select md5(coalesce(string_agg(c.relname || ':' || r.rolname || ':' || g.privilege_type, ',' order by c.relname, r.rolname, g.privilege_type), ''))
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
  join pg_roles r on r.oid = g.grantee
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and c.relname not in ('document_access_log', 'safety_hold_events', 'hand_over_events', 'account_closures', 'account_tombstones', 'account_deletion_records', 'account_closure_tasks')
    and ((r.rolname in ('anon', 'authenticated') and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
         or r.rolname = 'service_role')
$f$;

create function pg_temp.rights_hash_exec() returns text language sql as $f$
  select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || coalesce(r.rolname, 'PUBLIC'), ',' order by p.oid::regprocedure::text, coalesce(r.rolname, 'PUBLIC')), ''))
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
  left join pg_roles r on r.oid = g.grantee
  where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
    and p.proname not in ('log_document_access', 'admin_may_read_document', 'purge_old_document_access_log', 'place_safety_hold', 'release_safety_hold', 'profile_is_on_safety_hold',
                          'my_documents_are_kept', 'list_safety_holds', 'record_hand_over', 'record_hand_over_delivery', 'purge_old_hand_over_events',
                          'preview_account_closure', 'request_account_closure', 'admin_close_account', 'undo_account_closure', 'defer_account_closure', 'list_account_closures',
                          'read_account_tombstone', 'close_account_claim_tasks', 'close_account_task_result', 'run_account_closures', 'closure_int_setting', 'closure_is_adult',
                          'closure_is_super_admin', 'closure_busy', 'closure_has_open_dispute', 'closure_enqueue', 'closure_text', 'closure_household', 'closure_targets',
                          'closure_refund', 'closure_cancel_session', 'closure_start', 'closure_run', 'closure_wake_worker', 'closure_auth_link_is_safe', 'closure_delete_money',
                          'closure_enqueue_files', 'closure_delete_data', 'tier1_grant_documents')
    and g.privilege_type = 'EXECUTE' and (g.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role'))
$f$;

create function pg_temp.rights_count_extra() returns int language sql as $f$
  select count(*)::int
  from pg_class c, unnest(array['anon', 'authenticated']) as ro(r), unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as pr(p)
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and has_table_privilege(ro.r, c.oid, pr.p)
$f$;

create function pg_temp.rights_count_trigger_exec() returns int language sql as $f$
  select count(*)::int from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
$f$;

select set_config('test.dml_before', pg_temp.rights_hash_dml(), true),
       set_config('test.exec_before', pg_temp.rights_hash_exec(), true),
       set_config('test.extra_before', pg_temp.rights_count_extra()::text, true),
       set_config('test.trigexec_before', pg_temp.rights_count_trigger_exec()::text, true),
       set_config('test.guard_md5_before', md5(pg_get_functiondef('public.guard_verification_documents()'::regprocedure)), true),
       set_config('test.purge_md5_before', md5(pg_get_functiondef('public.purge_old_video_rooms()'::regprocedure)), true);
