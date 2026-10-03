-- 2026-09-30 (second session). Recording or correcting someone's date of birth is a sensitive admin
-- action (it decides who may tutor and who may book for themselves), so admin_set_date_of_birth()
-- now writes its own audit entry — it can't be skipped by a client that forgets to log. The date
-- itself is not copied into the log (POPIA minimality); the profile row holds it.

alter type public.audit_action add value if not exists 'date_of_birth_recorded';

create or replace function public.admin_set_date_of_birth(p_profile uuid, p_dob date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_previous date;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.is_plausible_date_of_birth(p_dob) then
    raise exception 'Enter a real date of birth';
  end if;
  select date_of_birth into v_previous from public.profiles where id = p_profile;
  if not found then
    raise exception 'No such profile';
  end if;
  update public.profiles set date_of_birth = p_dob where id = p_profile;
  insert into public.admin_audit_logs (admin_id, action, target_entity_type, target_entity_id, metadata)
  values (auth.uid(), 'date_of_birth_recorded', 'profiles', p_profile,
          jsonb_build_object('was_already_recorded', v_previous is not null));
end;
$$;
revoke all on function public.admin_set_date_of_birth(uuid, date) from public, anon;
grant execute on function public.admin_set_date_of_birth(uuid, date) to authenticated;
