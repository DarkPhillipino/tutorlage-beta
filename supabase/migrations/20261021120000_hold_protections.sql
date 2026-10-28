-- Hold protections (CEO's "yes, the three small protections", 21 Oct 2026). Apply AFTER 20261021100000_document_access_log.sql (it needs the safety hold).
-- A safety hold (place_safety_hold) used to stop only the 3-year clean-up of the access log. The report 2026-10-21-doclog.md listed what
-- else could still delete a held person's data; this closes the two that are in the database, and adds the admin list:
--   (a) video rooms: the daily clean-up (purge_old_video_rooms) now skips every room a held person hosted or joined.
--       REPLACES public.purge_old_video_rooms(): same signature, same attributes, same grants, and the text is the live text (dev, 21 Oct)
--       with ONE change, the extra "and not ..." conditions in the delete's WHERE. The daily job purge-old-video-rooms is unchanged.
--   (b) documents: a person on hold cannot remove or replace their own verification documents or the stored files.
--       NEW trigger function guard_held_documents() and trigger guard_held_documents on tutor_verification_documents (before update or
--       delete). The existing guard_verification_documents() (the 20261020170000 version) is NOT replaced: both triggers run, this one
--       first. REPLACES the storage policy "Tutors delete own documents" (the 20261013180100 text, one added condition at the end).
--       An admin is unaffected: the row policy and the new trigger both let an active admin through exactly as before.
--   (c) list_safety_holds(): the people currently on hold, for the admin screen "Safety holds". Admins only.
-- A hold changes nothing else: a held tutor can still add documents, and everything not named here behaves as before.

-- (a) ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.purge_old_video_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.video_rooms
  where coalesce(ended_at, expires_at) < now() - interval '30 days'
    and not public.profile_is_on_safety_hold(host_id)
    and not exists (select 1 from public.video_room_members m
                    where m.room_id = video_rooms.id and public.profile_is_on_safety_hold(m.profile_id));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.purge_old_video_rooms() from public, anon, authenticated;
grant execute on function public.purge_old_video_rooms() to service_role;

-- (b) ---------------------------------------------------------------------------------------------------------------------------
-- Says whether the SIGNED-IN person is on a safety hold. It answers only about the caller (it takes no argument), so it cannot be used
-- to look up anyone else. The storage policy below needs it because a policy runs with the caller's rights.
create or replace function public.my_documents_are_kept()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.profile_is_on_safety_hold(auth.uid());
$$;
revoke all on function public.my_documents_are_kept() from public, anon, authenticated;
grant execute on function public.my_documents_are_kept() to authenticated;

-- Before a tutor deletes a document row, or changes what it points at (the file, the type or the issue date), refuse if they are on hold.
-- Only the tutor's own rows reach this (the row policies), and an active admin passes untouched. Changing a status or note is already
-- refused by guard_verification_documents; adding a new document is not touched.
create or replace function public.guard_held_documents()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_changes boolean;
begin
  if current_user in ('authenticated', 'anon') and not public.is_active_admin() and old.tutor_id = auth.uid() then
    if tg_op = 'DELETE' then
      v_changes := true;
    else
      v_changes := (new.document_url, new.document_type, new.issued_on) is distinct from (old.document_url, old.document_type, old.issued_on);
    end if;
    if v_changes and public.my_documents_are_kept() then
      raise exception 'This document can''t be changed right now. If you need help, email support@tutorlage.com.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_held_documents() from public, anon, authenticated;

drop trigger if exists guard_held_documents on public.tutor_verification_documents;
create trigger guard_held_documents before update or delete on public.tutor_verification_documents
  for each row execute function public.guard_held_documents();

-- The stored files: a tutor can still delete a file that is theirs and not yet verified, but not one a verified document points at
-- (unchanged) and, new, not while they are on a safety hold. Storage answers a refused delete with "nothing deleted"; the row refusal
-- above is the one that gives the plain message, and the app removes the row first.
drop policy if exists "Tutors delete own documents" on storage.objects;
create policy "Tutors delete own documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tutor-documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and not exists (
      select 1 from public.tutor_verification_documents d
      where d.document_url = storage.objects.name and d.status = 'verified'
    )
    and not public.my_documents_are_kept()
  );

-- (c) ---------------------------------------------------------------------------------------------------------------------------
-- The people on hold now: the newest line of each person decides (placed = on hold). Names come from profiles as they are today.
create or replace function public.list_safety_holds()
returns table (
  hold_profile_id uuid, hold_name text, hold_email text, hold_is_tutor boolean,
  hold_reason text, hold_placed_by text, hold_placed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select h.profile_id, p.full_name, p.email,
           exists (select 1 from public.tutor_profiles t where t.id = h.profile_id),
           h.reason, h.admin_label, h.created_at
    from (select distinct on (e.profile_id) e.profile_id, e.event, e.reason, e.admin_label, e.created_at
          from public.safety_hold_events e
          order by e.profile_id, e.seq desc) h
    left join public.profiles p on p.id = h.profile_id
    where h.event = 'placed'
    order by h.created_at desc, h.profile_id;
end;
$$;
revoke all on function public.list_safety_holds() from public, anon, authenticated;
grant execute on function public.list_safety_holds() to authenticated;
