-- Fix for 20260930150000: Postgres caps regex repetition counts at 255, so '{4,500}' raised
-- "invalid repetition count" on every meeting link. Pattern and length are now checked separately.
alter table public.sessions drop constraint if exists sessions_meeting_url_https;
alter table public.sessions add constraint sessions_meeting_url_https
  check (meeting_url is null or (meeting_url ~ '^https://[^[:space:]]+$' and length(meeting_url) between 12 and 500));

create or replace function public.set_session_meeting_link(p_session_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_session record;
begin
  select tutor_id, student_id, status into v_session from public.sessions where id = p_session_id for update;
  if not found or v_session.tutor_id is distinct from auth.uid() then
    raise exception 'Only this session''s tutor can set its link' using errcode = '42501';
  end if;
  if v_session.status not in ('scheduled', 'pending_confirmation') then
    raise exception 'This session isn''t upcoming any more';
  end if;
  if p_url is null or p_url !~ '^https://[^[:space:]]+$' or length(p_url) not between 12 and 500 then
    raise exception 'Enter the full meeting link, starting with https://';
  end if;
  update public.sessions set meeting_url = p_url where id = p_session_id;
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (v_session.student_id, 'session_link', 'Your session link is ready',
          'Your tutor added the link to join your session.', p_session_id);
end;
$$;
