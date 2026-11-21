-- Removes the claim-race fixture (dev only) and puts the two settings back. Each step is separate so a refusal (for example an immutable ledger) does not hide the rest; the final select says what is left.
do $$
declare ids uuid[];
begin
  select array_agg(id) into ids from auth.users where email like 'zzrace.%@example.invalid';
  if ids is not null then
    begin delete from public.notifications where profile_id = any (ids); exception when others then raise notice 'notifications: %', sqlerrm; end;
    begin delete from public.sessions where student_id = any (ids) or tutor_id = any (ids); exception when others then raise notice 'sessions: %', sqlerrm; end;
    begin delete from public.session_requests where student_id = any (ids); exception when others then raise notice 'requests: %', sqlerrm; end;
    begin delete from auth.users where id = any (ids); exception when others then raise notice 'users: %', sqlerrm; end;
  end if;
  begin delete from public.schools_institutions where name = 'ZZ Race test school'; exception when others then raise notice 'school: %', sqlerrm; end;
  if to_regclass('public.zzrace_settings') is not null then
    update public.system_settings s set setting_value = z.old_value from public.zzrace_settings z where s.setting_key = z.setting_key;
  end if;
  drop table if exists public.zzrace_results;
  drop table if exists public.zzrace_settings;
end $$;
select (select count(*) from auth.users where email like 'zzrace.%@example.invalid') as users_left,
       (select count(*) from public.session_requests where paystack_reference like 'zzrace\_%') as requests_left,
       (select count(*) from public.wallet_ledger where idempotency_key like '%zzrace%' or idempotency_key like 'zzrace-top:%') as ledger_left;
