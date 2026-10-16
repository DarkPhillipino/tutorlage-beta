-- 16 Oct 2026 (the CEO's test: "when someone presses the change button for the grade ... it does nothing"): a parent could pick a
-- learner's grade only when adding the learner. After that nothing in the app, and nothing in the database, let a parent change it:
-- the "Change" button on the booking form sent a parent to the home page (where they already were), and the table's row-level rules
-- let a parent READ a linked learner's profile but never write it ("Parents can view linked student profiles" is select-only).
--
-- WHAT THIS ADDS (one new function; nothing is replaced):
--   set_learner_grade(p_learner uuid, p_grade text) returns text
--   Only a signed-in adult who has an ACTIVE guardian consent for that learner (the same test the rest of the guardian features use,
--   can_act_for_learner) may call it. The grade must be one of the names in grade_levels (matched without regard to capital letters;
--   the stored value is the table's own spelling). It changes that one learner's student_profiles.grade_level and nothing else, and
--   returns the grade as stored. A signed-out caller, a stranger, a parent whose consent was withdrawn, and a made-up grade are refused.
-- NOT touched: any table, policy, trigger or other function. A learner changes their own grade as before (their own row policy).

create or replace function public.set_learner_grade(p_learner uuid, p_grade text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_learner is null or not public.can_act_for_learner(p_learner) then
    raise exception 'Only the person who looks after this learner can change their grade' using errcode = '42501';
  end if;
  select name into v_name from public.grade_levels where lower(name) = lower(btrim(coalesce(p_grade, '')));
  if v_name is null then
    raise exception 'Choose a grade from the list' using errcode = '22023';
  end if;
  update public.student_profiles set grade_level = v_name, updated_at = now() where id = p_learner;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'That learner has no profile to change' using errcode = '22023';
  end if;
  return v_name;
end;
$function$;

revoke all on function public.set_learner_grade(uuid, text) from public, anon;
grant execute on function public.set_learner_grade(uuid, text) to authenticated;
