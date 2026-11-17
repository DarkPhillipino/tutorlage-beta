-- 17 Nov 2026, PM item 6b (found the same day): closing an account never touched founding_tutors_list, so a closed person's name, WhatsApp number, email, subjects and (since 17 Nov) date of birth
-- stayed on the waiting list for ever. This makes the closing cleanup delete the person's list row with the rest of their personal data.
--
-- WHAT THIS ADDS (additive; no table or policy changes; nothing already stored is touched):
--   NEW    function closure_delete_founding_row(uuid)   INTERNAL ONLY (no API role may call it; the closing cleanup calls it). Deletes the list row linked to the account (user_id) and any list row
--                                                       that carries the account's own email address (a row that was never linked), and returns how many it deleted.
--   PATCH  function closure_delete_data(uuid)           ONE line added, before the profile rows are blanked (while the original email still exists): the list row is deleted and the count is
--                                                       written into the deletion record's `deleted` list as `founding_list_rows`. Applied to the CURRENT stored text (read with pg_get_functiondef), so nothing
--                                                       anyone changed since is undone; it stops with an error, changing nothing, unless its anchor is found exactly once; a second run is a no-op.
-- The cleanup already returns before this point for a person on a safety hold, so a held person's list row is kept like their other data.
-- NOT touched: the closing rules, the 30-day wait, the tombstone, the final email, every other function, the page-event tables (anonymous visitor ids), founding_tutor_facts (verification facts by tutor id, no name).

create or replace function public.closure_delete_founding_row(p_profile uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  n integer;
begin
  select lower(btrim(coalesce(pr.email, ''))) into v_email from public.profiles pr where pr.id = p_profile;
  delete from public.founding_tutors_list f
   where f.user_id = p_profile
      or (coalesce(v_email, '') <> '' and v_email not like 'closed.%@closed.invalid' and f.email_key = v_email);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.closure_delete_founding_row(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_def text;
  v_old constant text := E'  -- The profile rows: blanked in place, never deleted.\n';
  v_new constant text := E'  -- The waiting-list row (name, WhatsApp, email, subjects, date of birth) goes with the account (PM item 6b, 17 Nov 2026).\n'
                      || E'  v_del := v_del || jsonb_build_object(''founding_list_rows'', public.closure_delete_founding_row(p));  -- CLOSING DELETES THE LIST ROW\n'
                      || v_old;
begin
  v_def := pg_get_functiondef('public.closure_delete_data(uuid)'::regprocedure);
  if position('CLOSING DELETES THE LIST ROW' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'closure_delete_data: the line to change was not found exactly once; nothing was changed';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
