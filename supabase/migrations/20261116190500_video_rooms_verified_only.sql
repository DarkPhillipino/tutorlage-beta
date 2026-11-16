-- 16 Nov 2026 (CEO, via the PM: option B). A video room can be opened ONLY by a verified tutor, whatever the `founding_tutors_gate` switch says.
-- Before: founding_gate_room_guard() refused an unverified host only while the switch was ON; on production the switch is OFF, so an unapproved tutor could open a room
-- and share its link. Now: the trigger (same name, still BEFORE INSERT on video_rooms, so create_video_room and open_video_session_room are both covered) always requires
-- tutor_profiles.is_verified for the host. A session room's host is the session's tutor (open_video_session_room), so a booked session with a verified tutor works as before.
-- NOT changed: the `founding_tutors_gate` switch (stays off), founding_gate_profile_guard (the switch-gated SIGN-UP guard), sign-up, the grants, or any other function.
-- The stricter test is is_verified itself, not the founding list's own word "verified" (the list can say verified for someone whose profile is not yet).
create or replace function public.founding_gate_room_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tutor_profiles tp where tp.id = new.host_id and tp.is_verified) then
    raise exception 'You can open video rooms once you are verified.' using errcode = '42501';
  end if;
  return new;
end;
$$;
