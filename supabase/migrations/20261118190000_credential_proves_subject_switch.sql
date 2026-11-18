-- 18 Nov 2026, SHOULD batch B (the Levels-screen tick-box, released by the PM 18 Nov): who may say which credentials PROVE subject competence (credential_definitions.proves_subject_competence,
-- made by 20261118130000). Purely ADDITIVE: ONE new function; the existing Levels functions are not touched (admin_save_credential_definition keeps saving label, level, recency and description).
-- admin_set_credential_proves_subject(code, value): super admin only, like every other change to the credential definitions. It flips that one flag and writes an audit event. It refuses an unknown code
-- and the built-in 'admin_assigned' (it has no document, so it can never be proof of competence). It changes no tutor's subject by itself: a tutor's subjects are approved only when an admin
-- presses the credential button on that tutor's page, and the database re-checks the credential, its document and Module 7 then.
-- Rollback: Drake/programmer/rollbacks/20261118190000_credential_proves_subject_switch_ROLLBACK.sql
create or replace function public.admin_set_credential_proves_subject(p_code text, p_value boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_before boolean;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['super_admin']) then
    raise exception 'Only a super admin can change which credentials prove subject competence' using errcode = '42501';
  end if;
  if p_value is null then
    raise exception 'Say yes or no' using errcode = '22023';
  end if;
  if v_code = 'admin_assigned' then
    raise exception 'The built-in "assigned by an admin" level has no document, so it can never prove subject competence' using errcode = '22023';
  end if;
  select d.proves_subject_competence into v_before from public.credential_definitions d where d.code = v_code for update;
  if not found then
    raise exception 'No such credential' using errcode = 'P0002';
  end if;
  if v_before is distinct from p_value then
    update public.credential_definitions set proves_subject_competence = p_value where code = v_code;
    perform public.log_admin_event('system_setting_updated', 'credential_definitions', gen_random_uuid(),
      jsonb_build_object('kind', 'credential_proves_subject_changed', 'credential', v_code, 'from', v_before, 'to', p_value));
  end if;
  return p_value;
end;
$$;
revoke all on function public.admin_set_credential_proves_subject(text, boolean) from public, anon, service_role;
grant execute on function public.admin_set_credential_proves_subject(text, boolean) to authenticated;
