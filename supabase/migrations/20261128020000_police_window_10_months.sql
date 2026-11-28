-- POLICE CLEARANCE AT REGISTRATION: the certificate counts if it was issued in the last 10 months, in place of 6 (CEO, 28 Nov 2026, so that students can
-- register with the certificate from their last teaching practice). Apply only after the site that shows the Terms 2026-11-28 is live.
-- Changes: the six functions that work the window out, the refusal sentence of admin_review_document, and the two current-version settings (every account
-- gets the app's notice that the Terms were updated). Unchanged: the age rule applies only at registration; the join list's own 6-month retention.
-- Undo: the same block with the two numbers swapped, and the version settings back to '2026-11-26', after the previous site is back.

do $mig$
declare
  f text;
  v_def text;
  v_old constant text := 'interval ''6 months''';
begin
  foreach f in array array[
    'public.admin_review_document(uuid, text, text, date)',
    'public.my_police_clearance_status()',
    'public.my_verification_checklist()',
    'public.police_clearance_problem(uuid)',
    'public.tutor_onboarding_finished(uuid)',
    'public.tutor_readiness(uuid)'
  ] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception '% is not the expected version: nothing changed', f;
    end if;
    v_def := replace(v_def, v_old, 'interval ''10 months''');
    v_def := replace(v_def, 'issued more than 6 months ago', 'issued more than 10 months ago');
    execute v_def;
  end loop;
end
$mig$;

update public.system_settings set setting_value = to_jsonb('2026-11-28'::text)
 where setting_key in ('current_terms_version', 'current_privacy_version');
