-- Rolled-back test of 20261116190000_card_checkout_allowlist.sql. Run it with scripts/run-rolled-back-test.mjs (the migration text first, this block second, in ONE statement; the
-- runner raises the report, FAIL lines first, verdict last). Uses real production rows read-only (Demo Parent, the CEO's admin sign-in, one ordinary account); every change
-- here (setting values, an expired review row) is undone by the rollback.
do $t$
declare
  f text := ''; r text := '';
  demo_p uuid; demo_l uuid; demo_t uuid; ceo uuid; gmail uuid; normal uuid;
  m text; a1 boolean; a2 boolean; a3 boolean; a4 boolean; a5 boolean;
  staff_n int;
  set_default text;
begin
  select user_id into demo_p from review_accounts where purpose = 'parent' and deleted_at is null limit 1;
  select user_id into demo_l from review_accounts where purpose = 'learner' and deleted_at is null limit 1;
  select user_id into demo_t from review_accounts where purpose = 'tutor' and deleted_at is null limit 1;
  select id into ceo from profiles where lower(email) = 'sechaba@tutorlage.god';
  select id into gmail from profiles where lower(email) = 'pakisosetunku@gmail.com';
  select p.id into normal from profiles p
   where not exists (select 1 from review_accounts x where x.user_id = p.id)
     and not exists (select 1 from card_checkout_staff s where s.profile_id = p.id)
     and (gmail is null or p.id <> gmail)
   order by p.created_at limit 1;
  if demo_p is null or demo_l is null or demo_t is null then f := f || 'FAIL C0 the three review accounts were not found' || E'\n'; end if;
  if ceo is null then f := f || 'FAIL C0 the CEO admin sign-in was not found' || E'\n'; end if;
  if normal is null then f := f || 'FAIL C0 no ordinary account to test with' || E'\n'; end if;

  -- C1: the migration seeded the mode as staff, and the CEO's sign-in is on the list (and nobody else is).
  select setting_value #>> '{}' into set_default from system_settings where setting_key = 'card_checkout_mode';
  select count(*) into staff_n from card_checkout_staff;
  if set_default is distinct from 'staff' then f := f || format('FAIL C1 seeded mode is %L, want staff' || E'\n', set_default); end if;
  if staff_n <> 1 or not exists (select 1 from card_checkout_staff where profile_id = ceo) then f := f || format('FAIL C1 staff list has %s rows, want exactly the CEO sign-in' || E'\n', staff_n); end if;
  r := r || format('C1 seeded mode %s; staff list rows %s' || E'\n', set_default, staff_n);

  -- C2: staff mode: the three review accounts and the CEO's sign-in are allowed; an ordinary account and the CEO's gmail are not.
  update system_settings set setting_value = '"staff"'::jsonb where setting_key = 'card_checkout_mode';
  if not (public.card_checkout_allowed(demo_p) and public.card_checkout_allowed(demo_l) and public.card_checkout_allowed(demo_t)) then f := f || 'FAIL C2 a review account is refused in staff mode' || E'\n'; end if;
  if not public.card_checkout_allowed(ceo) then f := f || 'FAIL C2 the CEO sign-in is refused in staff mode' || E'\n'; end if;
  if public.card_checkout_allowed(normal) then f := f || 'FAIL C2 an ordinary account is ALLOWED in staff mode' || E'\n'; end if;
  if gmail is not null and public.card_checkout_allowed(gmail) then f := f || 'FAIL C2 the CEO gmail is allowed without being listed' || E'\n'; end if;
  r := r || format('C2 staff mode: demo parent/learner/tutor %s/%s/%s, CEO sign-in %s, ordinary %s, gmail %s' || E'\n',
                   public.card_checkout_allowed(demo_p), public.card_checkout_allowed(demo_l), public.card_checkout_allowed(demo_t), public.card_checkout_allowed(ceo),
                   public.card_checkout_allowed(normal), case when gmail is null then 'n/a' else public.card_checkout_allowed(gmail)::text end);

  -- C3: off = nobody (the review accounts too); on = everyone.
  update system_settings set setting_value = '"off"'::jsonb where setting_key = 'card_checkout_mode';
  a1 := public.card_checkout_allowed(demo_p); a2 := public.card_checkout_allowed(ceo); a3 := public.card_checkout_allowed(normal);
  if a1 or a2 or a3 then f := f || format('FAIL C3 off mode allowed someone: demo %s ceo %s ordinary %s' || E'\n', a1, a2, a3); end if;
  update system_settings set setting_value = '"on"'::jsonb where setting_key = 'card_checkout_mode';
  a4 := public.card_checkout_allowed(normal);
  if not a4 then f := f || 'FAIL C3 on mode refused an ordinary account' || E'\n'; end if;
  r := r || format('C3 off: demo %s ceo %s ordinary %s; on: ordinary %s' || E'\n', a1, a2, a3, a4);

  -- C4: an odd word, a number, JSON null and a missing row all read as staff (never as on).
  update system_settings set setting_value = '"ON!!"'::jsonb where setting_key = 'card_checkout_mode';
  a1 := public.card_checkout_allowed(normal); m := public.card_checkout_mode();
  update system_settings set setting_value = '1'::jsonb where setting_key = 'card_checkout_mode';
  a2 := public.card_checkout_allowed(normal);
  update system_settings set setting_value = 'null'::jsonb where setting_key = 'card_checkout_mode';
  a3 := public.card_checkout_allowed(normal);
  delete from system_settings where setting_key = 'card_checkout_mode';
  a4 := public.card_checkout_allowed(normal); a5 := public.card_checkout_allowed(demo_p);
  if a1 or a2 or a3 or a4 then f := f || format('FAIL C4 a doubtful setting let an ordinary account in (%s %s %s %s)' || E'\n', a1, a2, a3, a4); end if;
  if m <> 'staff' or public.card_checkout_mode() <> 'staff' or not a5 then f := f || 'FAIL C4 doubtful setting did not read as staff' || E'\n'; end if;
  r := r || format('C4 odd/number/null/missing setting: ordinary %s/%s/%s/%s, demo parent in missing-row case %s, mode word %s' || E'\n', a1, a2, a3, a4, a5, m);
  insert into system_settings (setting_key, setting_value, description) values ('card_checkout_mode', '"staff"'::jsonb, 'test') on conflict (setting_key) do update set setting_value = '"staff"'::jsonb;

  -- C5: a review account that expired, or was marked deleted, is no longer on the allowlist; no person answers false.
  update review_accounts set expires_at = now() - interval '1 minute' where user_id = demo_p;
  a1 := public.card_checkout_allowed(demo_p);
  update review_accounts set expires_at = now() + interval '3 days', deleted_at = now() where user_id = demo_l;
  a2 := public.card_checkout_allowed(demo_l);
  a3 := public.card_checkout_allowed(null);
  if a1 or a2 or a3 then f := f || format('FAIL C5 expired %s deleted %s null %s (all want false)' || E'\n', a1, a2, a3); end if;
  r := r || format('C5 expired review account %s, deleted %s, no person %s' || E'\n', a1, a2, a3);

  -- C6: the browser door answers about the signed-in person only; nobody signed in is false.
  perform set_config('request.jwt.claim.sub', demo_t::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', demo_t::text, 'role', 'authenticated')::text, true);
  a1 := public.card_checkout_available();
  perform set_config('request.jwt.claim.sub', normal::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', normal::text, 'role', 'authenticated')::text, true);
  a2 := public.card_checkout_available();
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  a3 := public.card_checkout_available();
  if not a1 or a2 or a3 then f := f || format('FAIL C6 browser door: demo tutor %s (want true), ordinary %s, signed out %s (want false)' || E'\n', a1, a2, a3); end if;
  r := r || format('C6 browser door: demo tutor %s, ordinary %s, signed out %s' || E'\n', a1, a2, a3);

  -- C7: who may run what; the list is closed to browsers; the setting is a non-wallet key (so only a super admin can change it, see system_settings_role_guard).
  if has_function_privilege('authenticated', 'public.card_checkout_allowed(uuid)', 'execute') or has_function_privilege('anon', 'public.card_checkout_allowed(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.card_checkout_allowed(uuid)', 'execute') then f := f || 'FAIL C7 card_checkout_allowed grants wrong (service_role only)' || E'\n'; end if;
  if has_function_privilege('authenticated', 'public.card_checkout_mode()', 'execute') or has_function_privilege('anon', 'public.card_checkout_mode()', 'execute')
     or has_function_privilege('service_role', 'public.card_checkout_mode()', 'execute') then f := f || 'FAIL C7 card_checkout_mode is not internal' || E'\n'; end if;
  if not has_function_privilege('authenticated', 'public.card_checkout_available()', 'execute') or has_function_privilege('anon', 'public.card_checkout_available()', 'execute') then
    f := f || 'FAIL C7 card_checkout_available grants wrong (signed-in only)' || E'\n'; end if;
  if has_table_privilege('authenticated', 'public.card_checkout_staff', 'select') or has_table_privilege('anon', 'public.card_checkout_staff', 'select')
     or has_table_privilege('authenticated', 'public.card_checkout_staff', 'insert') then f := f || 'FAIL C7 the staff list is open to browsers' || E'\n'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.card_checkout_staff'::regclass) then f := f || 'FAIL C7 RLS is off on the staff list' || E'\n'; end if;
  if left('card_checkout_mode', 7) = 'wallet_' then f := f || 'FAIL C7 setting key falls under the wallet guard' || E'\n'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.system_settings'::regclass and tgname = 'system_settings_role_guard' and not tgisinternal) then
    f := f || 'FAIL C7 the super-admin settings guard trigger is missing' || E'\n'; end if;
  r := r || 'C7 grants: allowed=service_role only, mode=internal, available=signed-in only, staff table closed with RLS on; settings guard trigger present' || E'\n';

  perform set_config('test.report', E'CARD CHECKOUT ALLOWLIST TEST (rolled back)\n' || case when f = '' then 'NO FAILURES' else f end || E'\n' || r, true);
end $t$;
