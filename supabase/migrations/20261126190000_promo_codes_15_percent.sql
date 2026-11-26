-- PROMO CODES: 15 percent off the first 3 lessons, in place of 10 (CEO, 26 Nov 2026). Apply only after the site that shows the Terms 2026-11-26 is live.
-- Changes: the default for a new code (the tutor codes made at approval take it), the default of admin_create_promo_code when no percent is given, the
-- active codes that stood at 10, and the two current-version settings (every account gets the app's notice that the Terms were updated).
-- Lessons already booked keep the discount stored on them (promo_code_uses.percent_off). The discount still comes out of Tutorlage's share.
-- Undo: the same statements with 10 and '2026-11-25b', after the previous site is back.

alter table public.promo_codes alter column percent_off set default 15;

do $mig$
declare
  v_def text := pg_get_functiondef('public.admin_create_promo_code(text, text, integer, integer, timestamptz, timestamptz, integer, uuid)'::regprocedure);
  v_old constant text := 'coalesce(p_percent, 10)';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 3 then
    raise exception 'admin_create_promo_code is not the expected version: nothing changed';
  end if;
  execute replace(v_def, v_old, 'coalesce(p_percent, 15)');
end
$mig$;

update public.promo_codes set percent_off = 15 where active and percent_off = 10;

update public.system_settings set setting_value = to_jsonb('2026-11-26'::text)
 where setting_key in ('current_terms_version', 'current_privacy_version');
