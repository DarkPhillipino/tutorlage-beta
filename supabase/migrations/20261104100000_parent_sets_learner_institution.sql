-- 4 Nov 2026 (the CEO, on the Paystack demo accounts: "why isn't the demo student's institution being saved?"). A parent who picks the
-- school or institution for a learner they are booking for could never save it: the table's row-level rules let a parent READ a linked
-- learner's profile but never write it, so the app kept the choice in that one browser only ("remembered on this device only") and it was
-- lost on any other device or sign-in. Proved on production with a rolled-back run: as the learner the update changes 1 row, as the parent 0.
--
-- WHAT THIS ADDS (one new function; nothing is replaced; same shape as set_learner_grade, migration 20261016150000):
--   set_learner_institution(p_learner uuid, p_institution uuid) returns uuid
--   Only a signed-in adult who has an ACTIVE guardian consent for that learner (can_act_for_learner) may call it. The institution must be
--   one of schools_institutions. It changes that one learner's student_profiles.school_id and nothing else, and returns the id as stored.
--   A signed-out caller, a stranger, a parent whose consent was withdrawn and an unknown institution are refused.
-- NOT touched: any table, policy, trigger or other function. A learner with their own sign-in changes their own row as before.

create or replace function public.set_learner_institution(p_learner uuid, p_institution uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_learner is null or not public.can_act_for_learner(p_learner) then
    raise exception 'Only the person who looks after this learner can change their institution' using errcode = '42501';
  end if;
  if p_institution is null or not exists (select 1 from public.schools_institutions where id = p_institution) then
    raise exception 'Choose an institution from the list' using errcode = '22023';
  end if;
  update public.student_profiles set school_id = p_institution, updated_at = now() where id = p_learner;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'That learner has no profile to change' using errcode = '22023';
  end if;
  return p_institution;
end;
$function$;

revoke all on function public.set_learner_institution(uuid, uuid) from public, anon;
grant execute on function public.set_learner_institution(uuid, uuid) to authenticated;
