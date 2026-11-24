-- RUN 7, PM lines 73, 75 and 77 (24 Nov 2026): the tutor's OWN photo upload. ADDITIVE: nothing that exists is changed except one new nullable column.
-- What it does: a tutor adds or replaces her own photo (cropped to a circle in her browser, 512 px JPEG, 2 MB maximum). The file goes into a PRIVATE bucket `tutor-photos`, in her own folder (<her id>/pending.jpg).
-- It stays PENDING: it has NO public effect. `public_tutor_page` and the share card still serve only the APPROVED copy (tutor_photo.photo_data, status approved), which this migration never writes.
-- The company's approve-or-reject screen is next week's work; until it exists a pending photo is simply waiting. She can remove her photo (approved copy and pending file) at any time; it disappears at once.
-- Tutors only: every function checks tutor_profiles; the bucket policies check it too. No photos for learners or parents.
-- UNDO: Drake/programmer/rollbacks/20261125110000_tutor_photo_upload_ROLLBACK.sql (drops the functions, the policies and the bucket's objects/bucket, drops the column).

alter table public.tutor_photo add column if not exists pending_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutor-photos', 'tutor-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Tutors add own photo" on storage.objects;
create policy "Tutors add own photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'tutor-photos' and (storage.foldername(name))[1] = auth.uid()::text
              and exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()));
drop policy if exists "Tutors replace own photo" on storage.objects;
create policy "Tutors replace own photo" on storage.objects for update to authenticated
  using (bucket_id = 'tutor-photos' and (storage.foldername(name))[1] = auth.uid()::text
         and exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()))
  with check (bucket_id = 'tutor-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Tutors read own photo" on storage.objects;
create policy "Tutors read own photo" on storage.objects for select to authenticated
  using (bucket_id = 'tutor-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Tutors remove own photo" on storage.objects;
create policy "Tutors remove own photo" on storage.objects for delete to authenticated
  using (bucket_id = 'tutor-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Admins read all tutor photos" on storage.objects;
create policy "Admins read all tutor photos" on storage.objects for select to authenticated
  using (bucket_id = 'tutor-photos' and public.is_active_admin());

-- Her own picture of the state: her approved photo (she may see her own), and whether a new one is waiting.
create or replace function public.my_photo()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare r record;
begin
  if auth.uid() is null or not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then
    return jsonb_build_object('is_tutor', false);
  end if;
  select ph.photo_data, ph.status, ph.pending_path, ph.pending_at, ph.reject_reason into r from public.tutor_photo ph where ph.tutor_id = auth.uid();
  return jsonb_build_object(
    'is_tutor', true,
    'approved', case when r.status = 'approved' then r.photo_data end,
    'pending', coalesce(r.pending_path is not null, false),
    'pending_at', r.pending_at,
    'rejected', coalesce(r.status = 'rejected', false));
end;
$function$;
revoke all on function public.my_photo() from public, anon;
grant execute on function public.my_photo() to authenticated;

-- Record that her new file is in her folder. Pending only: the approved copy and the public page are not touched.
create or replace function public.submit_my_photo(p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then
    raise exception 'Only tutors can add a photo' using errcode = '42501';
  end if;
  if p_path is distinct from auth.uid()::text || '/pending.jpg' then
    raise exception 'That is not your photo file' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'tutor-photos' and o.name = p_path) then
    raise exception 'The photo file was not found. Please try again.' using errcode = '22023';
  end if;
  insert into public.tutor_photo (tutor_id, status, pending_path, pending_at)
  values (auth.uid(), 'waiting', p_path, now())
  on conflict (tutor_id) do update
    set pending_path = excluded.pending_path, pending_at = now(), reject_reason = null,
        status = case when public.tutor_photo.status = 'rejected' then 'waiting' else public.tutor_photo.status end,
        updated_at = now();
end;
$function$;
revoke all on function public.submit_my_photo(text) from public, anon;
grant execute on function public.submit_my_photo(text) to authenticated;

-- She removes her photo: the approved copy stops being served at once and the waiting file is forgotten. (The browser deletes the file in her folder; a file left behind is private and harmless.)
create or replace function public.remove_my_photo()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then
    raise exception 'Only tutors can remove a photo' using errcode = '42501';
  end if;
  update public.tutor_photo
     set photo_data = null, status = 'waiting', basis = null, basis_at = null, reviewed_by = null, reviewed_at = null,
         reject_reason = null, pending_path = null, pending_at = null, updated_at = now()
   where tutor_id = auth.uid();
end;
$function$;
revoke all on function public.remove_my_photo() from public, anon;
grant execute on function public.remove_my_photo() to authenticated;
