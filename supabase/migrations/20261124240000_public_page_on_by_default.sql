-- JOB ON-BY-DEFAULT (PM lines 61 and 66, 24 Nov 2026; CEO: "minimum work for tutors is a must to retain them").
-- A tutor's public page, /t/CODE, is ON from the moment she is verified. The basis is recorded HONESTLY: it is on because of the Terms (Part B, version 2026-11-24, already published),
-- NOT because she clicked yes, so consent_at stays empty for these. Switching it OFF hides everything at once (withdrawn_at is stamped, as before); switching it back ON is her own act
-- (the Teach screen asks her to tick, and then consent_at is filled, as before).
--   NEW columns  tutor_public_profile.basis, tutor_public_profile.basis_at: why the page is on, and since when.
--   NEW trigger  trg_tutor_public_page_on_verified (after approval, runs after the personal-code trigger by name): creates her row with the page ON (only if she has no row, so an earlier
--                choice of hers is never overridden), only when she has a code and a level the page can show (not 4C/4D), and sends her one bell notice with the link. Never fails an approval.
--   CHANGED      set_my_public_profile(): when SHE switches on, the basis says so ("switched on by the tutor, after the tick") and consent_at is filled as before.
--   DATA         the two existing rows (Odi, Amira) get the basis "switched on by the company on the CEO's order, 24 Nov 2026", with that date; their consent_at (filled by the company on 24 Nov
--                07:03 UTC) is emptied because they did not consent through the app. Old values saved in Drake/programmer/backups/2026-11-24-tutor_public_profile.md.
-- UNDO: drop trigger trg_tutor_public_page_on_verified on public.tutor_profiles; drop function public.tutor_public_page_on_verified(); restore set_my_public_profile from the backup file;
--       restore the two rows' consent_at from the backup file; alter table public.tutor_public_profile drop column basis, drop column basis_at.

alter table public.tutor_public_profile add column if not exists basis text;
alter table public.tutor_public_profile add column if not exists basis_at timestamptz;

create or replace function public.tutor_public_page_on_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  begin
    select pc.code into v_code from public.promo_codes pc where pc.owner_tutor_id = new.id and pc.active order by pc.created_at limit 1;
    if v_code is null or new.current_sub_tier_id is null or new.current_sub_tier_id in ('4C', '4D') then return null; end if;
    insert into public.tutor_public_profile (tutor_id, is_public, consent_at, withdrawn_at, basis, basis_at, updated_at)
    values (new.id, true, null, null, 'default on under Terms Part B (version 2026-11-24)', now(), now())
    on conflict (tutor_id) do nothing;
    if found then
      insert into public.notifications (profile_id, type, title, body)
      values (new.id, 'public_page_live', 'Your public tutor page is live',
              'Your public tutor page is live: https://tutorlage.com/t/' || v_code || '. Share it on your WhatsApp status. You can switch it off any time on your Teach screen.');
    end if;
  exception when others then
    null;   -- a public page is a convenience; an approval must never fail because of it
  end;
  return null;
end;
$$;
revoke all on function public.tutor_public_page_on_verified() from public, anon, authenticated;

drop trigger if exists trg_tutor_public_page_on_verified on public.tutor_profiles;
create trigger trg_tutor_public_page_on_verified
  after update of is_verified on public.tutor_profiles
  for each row when (new.is_verified and not coalesce(old.is_verified, false))
  execute function public.tutor_public_page_on_verified();

create or replace function public.set_my_public_profile(p_public boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v_me := public.my_public_profile();
  if coalesce((v_me ->> 'is_tutor')::boolean, false) is not true then raise exception 'Only a tutor has a public page' using errcode = '42501'; end if;
  if p_public is true then
    if coalesce((v_me ->> 'can_be_public')::boolean, false) is not true then
      raise exception 'Your page can be switched on once you are approved and have your code';
    end if;
    insert into public.tutor_public_profile (tutor_id, is_public, consent_at, withdrawn_at, basis, basis_at, updated_at)
    values (auth.uid(), true, now(), null, 'switched on by the tutor, after the tick', now(), now())
    on conflict (tutor_id) do update set is_public = true, consent_at = now(), withdrawn_at = null,
      basis = 'switched on by the tutor, after the tick', basis_at = now(), updated_at = now();
  else
    insert into public.tutor_public_profile (tutor_id, is_public, withdrawn_at, updated_at) values (auth.uid(), false, null, now())
    on conflict (tutor_id) do update set is_public = false, withdrawn_at = case when public.tutor_public_profile.is_public then now() else public.tutor_public_profile.withdrawn_at end, updated_at = now();
  end if;
end;
$function$;

-- the two pages the company switched on (Odi and Amira), recorded as what they are
update public.tutor_public_profile
   set basis = 'switched on by the company on the CEO''s order, 24 Nov 2026', basis_at = coalesce(consent_at, updated_at), consent_at = null
 where tutor_id in ('847d3f13-7c3c-46a4-92a5-34026a90f1aa', '3379c014-33ed-4833-92da-28242b20cc81') and is_public and basis is null;
