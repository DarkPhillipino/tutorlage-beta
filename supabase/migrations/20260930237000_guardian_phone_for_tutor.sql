-- 2026-09-30 (third session). Backlog 7k, legal spec §5 (`Drake/legal/specs/7k-minors-consent-and-
-- acceptance.md`): for a learner under 18, "the guardian's phone number must be on the account and
-- shown to the tutor for the session (so a parent is reachable)". Neither was true: the phone field at
-- sign-up is optional, Google sign-ups have none, and a tutor had no way to see any guardian contact.
--
-- 1. A guardian's booking for a learner is refused until the guardian's own phone number is on file
--    (parent_profiles.phone_number — the guardian can already update their own row). Same bypass as
--    guard_session_request_insert: only client roles are checked.
-- 2. my_session_guardian_contacts(): a tutor gets the name and phone of the guardian who booked each
--    of their scheduled sessions — only their own sessions, only guardian bookings, nothing for anyone
--    else. Guardian bookings are the only way a learner under 18 can be booked (can_book_for).
--
-- Dev history: applied as guardian_phone_for_tutor, then guardian_phone_only_for_linked_guardians
-- (the first version also fired for a stranger booking for someone else's learner, who was then told
-- to add a phone instead of being refused by the booking rule — misleading). This file is the final
-- version; production gets it in one step.

create or replace function public.guard_guardian_booking_phone()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_phone text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Only a guardian actually linked to this learner; anyone else booking for someone else is refused
  -- by the session_requests insert policy (can_book_for), with its own reason.
  if new.requested_by_profile_id is distinct from new.student_id
     and exists (select 1 from public.parent_student_links
                 where parent_id = new.requested_by_profile_id and student_id = new.student_id) then
    select phone_number into v_phone from public.parent_profiles where id = new.requested_by_profile_id;
    if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) < 9 then
      raise exception 'Add your phone number before booking for a learner — their tutor needs to be able to reach you during the session';
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_guardian_booking_phone() from public, anon, authenticated;

drop trigger if exists guard_guardian_booking_phone on public.session_requests;
create trigger guard_guardian_booking_phone
  before insert on public.session_requests
  for each row execute function public.guard_guardian_booking_phone();

create or replace function public.my_session_guardian_contacts()
returns table (session_id uuid, guardian_name text, guardian_phone text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.id, trim(concat(pp.first_name, ' ', pp.surname)), pp.phone_number
  from public.sessions s
  join public.parent_student_links l on l.student_id = s.student_id and l.parent_id = s.booked_by_profile_id
  join public.parent_profiles pp on pp.id = s.booked_by_profile_id
  where s.tutor_id = auth.uid()
    and s.status = 'scheduled'
    and s.booked_by_profile_id is distinct from s.student_id;
$function$;

revoke execute on function public.my_session_guardian_contacts() from public, anon;
grant execute on function public.my_session_guardian_contacts() to authenticated;
