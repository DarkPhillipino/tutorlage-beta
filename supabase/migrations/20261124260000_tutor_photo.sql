-- PM lines 72 to 74 (24 Nov 2026): a tutor's profile photo, stored and approved by the company, shown on her public page and used on her share card.
-- THIS IS THE SMALLEST CUT (Odi's photo on her card and page). The table already has the columns the upload and the approval queue will need (pending_path, reviewed_*, reject_reason).
--   NEW table public.tutor_photo   one row per tutor. `photo_data` = the APPROVED copy only: a small 512 px JPEG as a data address, kept in the database so that withdrawing the page hides it at
--                                  once and no file stays reachable by a guessed link. `status` waiting / approved / rejected; `basis` says honestly how it came to be approved. Nobody can read or write
--                                  the table from the app (no rights, row security on); only the function below, which runs as the owner, reads it.
--   CHANGED public_tutor_page(code)  adds 'photo' = the approved copy, or null. The function already answers nothing unless her page is ON and she is verified, so a page switched off shows no photo at once.
-- UNDO: restore the previous public_tutor_page (saved in Drake/programmer/backups/2026-11-24-public_tutor_page-before-photo.md) and `drop table public.tutor_photo;`

create table if not exists public.tutor_photo (
  tutor_id uuid primary key references public.tutor_profiles (id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'rejected')),
  photo_data text check (photo_data is null or (photo_data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' and length(photo_data) <= 250000)),
  pending_path text,
  basis text,
  basis_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  reject_reason text,
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or photo_data is not null)
);
alter table public.tutor_photo enable row level security;
revoke all on table public.tutor_photo from public, anon, authenticated, service_role;

create or replace function public.public_tutor_page(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tutor uuid;
  v_code text;
  v_first text;
  v_level text;
  v_tier text;
  v_price numeric;
  v_cur text;
  v_hours text;
begin
  select pc.owner_tutor_id, pc.code into v_tutor, v_code
    from public.promo_codes pc
   where pc.code = public.promo_normalise(p_code) and pc.owner_tutor_id is not null and pc.active
   limit 1;
  if v_tutor is null then return null; end if;
  if not exists (select 1 from public.tutor_public_profile x where x.tutor_id = v_tutor and x.is_public) then return null; end if;
  select s.id, t.public_name, s.max_allowed_rate, trim(t.currency_code)
    into v_level, v_tier, v_price, v_cur
    from public.tutor_profiles tp
    join public.sub_tier_definitions s on s.id = tp.current_sub_tier_id
    join public.tier_definitions t on t.id = s.tier_id
   where tp.id = v_tutor and tp.is_verified and s.id not in ('4C', '4D');
  if v_level is null then return null; end if;
  select coalesce(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), 'A Tutorlage tutor') into v_first from public.profiles p where p.id = v_tutor;
  v_hours := public.tutor_hours_in_words(v_tutor);
  return jsonb_build_object(
    'code', v_code,
    'first_name', coalesce(v_first, 'A Tutorlage tutor'),
    'level_id', v_level,
    'level_name', v_tier,
    'price', v_price,
    'currency', v_cur,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('subject', x.subject_name, 'min_grade', x.min_grade_level, 'max_grade', x.max_grade_level) order by x.subject_name, x.min_grade_level)
        from (select distinct c.subject_name, c.min_grade_level, c.max_grade_level from public.tutor_subject_competencies c
               where c.tutor_id = v_tutor and c.verification_status = 'verified') x), '[]'::jsonb),
    'checked', to_jsonb(public.tutor_checked_lines(v_tutor)),
    'hours', v_hours,
    'taking_requests', v_hours is not null,
    'photo', (select ph.photo_data from public.tutor_photo ph where ph.tutor_id = v_tutor and ph.status = 'approved'));
end;
$function$;
revoke all on function public.public_tutor_page(text) from public;
grant execute on function public.public_tutor_page(text) to anon, authenticated;
