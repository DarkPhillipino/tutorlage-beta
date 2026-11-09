-- SUGGESTIONS BOX: TRIM LINE BREAKS AND TABS TOO (fix forward, 9 Nov 2026; APPLIED TO PRODUCTION as 20261109054516 platform_suggestions_trim_whitespace).
-- The bug (found by the first production run of supabase/tests/platform_suggestions.sql, checks W2, LEN2 and LEN5): the insert trigger trimmed the text with
-- btrim(coalesce(new.body, '')), and the one-argument btrim removes SPACES ONLY. So a text made only of line breaks (or tabs) was stored instead of refused,
-- and a trailing line break was kept. The fix is one line: btrim(coalesce(new.body, ''), E' \t\r\n') removes spaces, tabs, carriage returns and line
-- breaks from both ends; an inner line break stays. The coalesce stays on purpose: a NULL body then reads as empty and is refused with the plain sentence,
-- instead of passing both length checks (a comparison with null is not true) and failing later on the not-null rule with a database message. Verified rolled back on production on 9 Nov: a trailing line break is trimmed, whitespace-only and tab/CR/LF-only
-- texts are refused (22023), an inner line break is kept, a 1,000-character text is stored whole.
-- This file holds exactly the function that was applied (create or replace, then the revoke again so the rights are the same as before). Nothing else
-- changes: the trigger platform_suggestions_before_insert stays attached to the table. 20261105120000_platform_suggestions.sql now carries the same line,
-- so a fresh database ends the same way whether it applies one file or both.
-- (Not changed, and a smaller point: the admin's internal note in admin_handle_suggestion() is still trimmed with the one-argument btrim, so a note
-- made only of line breaks is kept as it is. Admin-only text, no effect on a person; change it in a later migration if wanted.)

create or replace function public.platform_suggestions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_recent integer;
  c_limit constant integer := 5;
begin
  select p.role::text into v_role from public.profiles p where p.id = new.user_id;
  if v_role is null then
    raise exception 'We could not find your account. Please sign in again.' using errcode = '23503';
  end if;

  new.body := btrim(coalesce(new.body, ''), E' \t\r\n');
  if char_length(new.body) < 1 then
    raise exception 'Please write your suggestion first.' using errcode = '22023';
  end if;
  if char_length(new.body) > 1000 then
    raise exception 'Please keep your suggestion to 1,000 characters or fewer.' using errcode = '22023';
  end if;

  -- At most 5 in any 24 hours per person. The lock makes two sends at the same moment count one after the other.
  perform pg_advisory_xact_lock(hashtextextended('platform_suggestions:' || new.user_id::text, 0));
  select count(*) into v_recent from public.platform_suggestions s
  where s.user_id = new.user_id and s.created_at > now() - interval '24 hours';
  if v_recent >= c_limit then
    raise exception 'You can send up to 5 suggestions a day. Please try again tomorrow.' using errcode = '54000';
  end if;

  -- What the database decides, whatever the caller sent.
  new.role := v_role;
  new.status := 'new';
  new.admin_note := null;
  new.handled_at := null;
  new.handled_by := null;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.platform_suggestions_before_insert() from public, anon, authenticated, service_role;
