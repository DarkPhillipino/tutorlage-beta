-- 17 Nov 2026, PM item 6 (decision): once an account exists for a waiting-list row, the row's DATE OF BIRTH is cleared (the account holds it). The row keeps the first name, surname, number and
-- email for the sign-up funnel until the account is closed (then it is deleted: migration 20261117200000). The Privacy text now says exactly this, so this must be true before that text is published.
--
-- WHAT THIS DOES (additive; no table or policy changes):
--   PATCH  function founding_link_on_tutor_profile()    the trigger that links a list row to the account when its tutor profile is made: the same update now also clears the row's
--                                                       date_of_birth, but ONLY when the account really holds a date of birth (a person whose account has none yet keeps the row's until they give it). Applied
--                                                       to the CURRENT stored text, exactly once or not at all; a second run is a no-op.
--   NEW    function + trigger founding_clear_dob_on_profile   when a linked person's account later gets its date of birth (the "One more step" screen, or an admin), the row's copy is cleared then.
--                                                       Never raises: it can never stop a profile update.
--   DATA   one-time clean-up: rows that already have an account AND whose account holds a date of birth have theirs cleared (0 rows on production when written).
-- NOT touched: the sign-up trigger, the join and prefill functions (the prefill reads the date of birth only BEFORE an account exists), every policy.

do $patch$
declare
  v_def text;
  v_old constant text := E'       set user_id = new.id\n';
  v_new constant text := E'       set user_id = new.id,\n'
                      || E'           date_of_birth = case when exists (select 1 from public.profiles pr where pr.id = new.id and pr.date_of_birth is not null) then null else f.date_of_birth end  -- DOB CLEARED WITH THE ACCOUNT\n';
begin
  v_def := pg_get_functiondef('public.founding_link_on_tutor_profile()'::regprocedure);
  if position('DOB CLEARED WITH THE ACCOUNT' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'founding_link_on_tutor_profile: the line to change was not found exactly once; nothing was changed';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

create or replace function public.founding_clear_dob_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.date_of_birth is not null then
      update public.founding_tutors_list f set date_of_birth = null where f.user_id = new.id and f.date_of_birth is not null;
    end if;
  exception when others then
    null;  -- never stop a profile update
  end;
  return null;
end;
$$;
revoke all on function public.founding_clear_dob_on_profile() from public, anon, authenticated, service_role;

drop trigger if exists founding_clear_dob_on_profile on public.profiles;
create trigger founding_clear_dob_on_profile
  after update of date_of_birth on public.profiles
  for each row
  when (new.date_of_birth is not null and new.date_of_birth is distinct from old.date_of_birth)
  execute function public.founding_clear_dob_on_profile();

update public.founding_tutors_list f
   set date_of_birth = null
 where f.user_id is not null and f.date_of_birth is not null
   and exists (select 1 from public.profiles p where p.id = f.user_id and p.date_of_birth is not null);
