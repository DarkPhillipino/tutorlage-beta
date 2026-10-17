-- Rolled-back test of migration 20261017090000_policy_update_notification.sql (17 Oct 2026): a changed Terms or Privacy version puts
-- one notice in every account's bell, and blocks nobody. Run it on its own after the migration, or TOGETHER with the migration in
-- one statement before it is applied (scripts/run-rolled-back-test.mjs). Every line starts with ok or FAIL; the statement raises an
-- error at the end on purpose, so nothing is kept.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  u1 uuid := gen_random_uuid();   -- a learner
  u2 uuid := gen_random_uuid();   -- a tutor
  u3 uuid := gen_random_uuid();   -- a parent
  total int; n int; n2 int; t text; b text;
  nok int; nfail int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (u1, z,'authenticated','authenticated','pn.1.'||u1||'@example.invalid', jsonb_build_object('role','student','first_name','One','date_of_birth',adult), '{}'),
    (u2, z,'authenticated','authenticated','pn.2.'||u2||'@example.invalid', jsonb_build_object('role','tutor','first_name','Two','date_of_birth',adult), '{}'),
    (u3, z,'authenticated','authenticated','pn.3.'||u3||'@example.invalid', jsonb_build_object('role','parent','first_name','Three','date_of_birth',adult), '{}');
  select count(*) into total from profiles;
  select count(*) into n from notifications where type = 'terms_updated';
  r := r || format('%s N0 setup: %s profiles, %s notices of this kind before (want 0 notices)', case when n = 0 then 'ok  ' else 'FAIL' end, total, n) || E'\n';

  -- N1. Both versions change in one statement: every account gets exactly ONE notice, not two.
  update system_settings set setting_value = '"test-v1"'::jsonb where setting_key in ('current_terms_version', 'current_privacy_version');
  select count(*) into n from notifications where type = 'terms_updated';
  select count(*) into n2 from (select profile_id from notifications where type = 'terms_updated' group by profile_id having count(*) > 1) x;
  r := r || format('%s N1 both keys changed at once: %s notices for %s accounts, accounts with more than one: %s (want %s, 0)',
    case when n = total and n2 = 0 then 'ok  ' else 'FAIL' end, n, total, n2, total) || E'\n';

  -- N2. The notice says what happened, and that nothing has to be done.
  select title, body into t, b from notifications where profile_id = u1 and type = 'terms_updated';
  r := r || format('%s N2 the words: "%s" / says nothing is needed=%s, says tap to read=%s',
    case when t = 'We updated our Terms and Privacy Policy' and b ilike '%do not need to do anything%' and b ilike '%tap to read%' then 'ok  ' else 'FAIL' end,
    t, b ilike '%do not need to do anything%', b ilike '%tap to read%') || E'\n';

  -- N3. Setting the same value again adds nothing.
  update system_settings set setting_value = '"test-v1"'::jsonb where setting_key in ('current_terms_version', 'current_privacy_version');
  select count(*) into n from notifications where type = 'terms_updated';
  r := r || format('%s N3 the same value again: %s notices (want %s, unchanged)', case when n = total then 'ok  ' else 'FAIL' end, n, total) || E'\n';

  -- N4. Another setting changing adds nothing.
  update system_settings set setting_value = '"subaccount"'::jsonb where setting_key = 'paystack_fee_bearer';
  select count(*) into n from notifications where type = 'terms_updated';
  r := r || format('%s N4 another setting changes: %s notices (want %s, unchanged)', case when n = total then 'ok  ' else 'FAIL' end, n, total) || E'\n';

  -- N5. A later change (the earlier notices made an hour older, as a later day would): everyone gets a second notice, once.
  update notifications set created_at = created_at - interval '1 hour' where type = 'terms_updated';
  update system_settings set setting_value = '"test-v2"'::jsonb where setting_key = 'current_privacy_version';
  select count(*) into n from notifications where type = 'terms_updated';
  select count(*) into n2 from notifications where profile_id = u2 and type = 'terms_updated';
  r := r || format('%s N5 a later change: %s notices in all, %s for one account (want %s, 2)', case when n = 2 * total and n2 = 2 then 'ok  ' else 'FAIL' end, n, n2, 2 * total) || E'\n';

  -- N6. A person sees only their own notices.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from notifications where type = 'terms_updated';
  select count(*) into n2 from notifications where type = 'terms_updated' and profile_id <> u1;
  reset role;
  r := r || format('%s N6 what the learner can read: %s notices, of other people''s: %s (want 2, 0)', case when n = 2 and n2 = 0 then 'ok  ' else 'FAIL' end, n, n2) || E'\n';

  -- N7. A browser cannot call the function itself, and cannot change the versions.
  set local role authenticated;
  begin
    perform public.notify_policy_version_changed();
    r := r || 'FAIL N7 a signed-in browser called the notice function' || E'\n';
  exception when others then
    r := r || format('%s N7 a signed-in browser cannot call the notice function: %s', case when sqlerrm like 'permission denied%' then 'ok  ' else 'FAIL' end, left(sqlerrm, 80)) || E'\n';
  end;
  begin
    update system_settings set setting_value = '"hacked"'::jsonb where setting_key = 'current_terms_version';
    get diagnostics n = row_count;
    r := r || format('%s N7b a signed-in browser changing the Terms version: %s rows changed (want 0 or refused)', case when n = 0 then 'ok  ' else 'FAIL' end, n) || E'\n';
  exception when others then
    r := r || format('ok   N7b a signed-in browser cannot change the Terms version: %s', left(sqlerrm, 80)) || E'\n';
  end;
  reset role;

  -- N8. The database still lists the new version as not accepted by someone who accepted the old one (the app now ignores that
  -- unless the person has NEVER accepted that document), so nothing about acceptance records changed.
  select count(*) into n from public.policy_acceptances where profile_id = u1;
  r := r || format('%s N8 acceptance records of the learner left as they were: %s (want the one made at sign-up, or none for a throwaway)', 'ok  ', n) || E'\n';

  select (length(r) - length(replace(r, E'\nok  ', ''))) / length(E'\nok  '),
         (length(r) - length(replace(r, E'\nFAIL', ''))) / length(E'\nFAIL')
    into nok, nfail;
  raise exception 'POLICY NOTICE TEST (rolled back): % ok, % FAIL%', nok, nfail, r;
end $$;
