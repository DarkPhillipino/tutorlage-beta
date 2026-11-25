-- A VERIFIED TUTOR NEVER MEETS THE REGISTRATION RULE ABOUT THE POLICE CERTIFICATE'S AGE (PM line 81 B, 25 Nov 2026; CEO, 24 Nov: the age matters only
-- at registration). One rule in one place: police_certificate_age_applies(tutor) is true for everyone who is not a verified tutor. Every function that
-- looks at the 6 months now asks it. Unverified tutors keep today's rules. No row of any table is changed.
create or replace function public.police_certificate_age_applies(p_tutor uuid)
returns boolean language sql stable security definer set search_path = public as $f$
  select not exists (select 1 from public.tutor_profiles tp where tp.id = p_tutor and tp.is_verified);
$f$;
revoke all on function public.police_certificate_age_applies(uuid) from public, anon, authenticated;

do $patch$
declare
  e record;
  v_def text;
  v_hits integer;
begin
  for e in
    select * from (values
      ('public.police_clearance_problem(uuid)',
       $o$if exists (select 1 from public.tutor_profiles tp where tp.id = p_tutor and tp.is_verified) then$o$,
       $n$if not public.police_certificate_age_applies(p_tutor) then$n$),
      ('public.tutor_readiness(uuid)',
       $o$select coalesce(tp.is_verified, false) into v_verified from public.tutor_profiles tp where tp.id = p_tutor;$o$,
       $n$v_verified := not public.police_certificate_age_applies(p_tutor);$n$),
      ('public.my_police_clearance_status()',
       $o$case when t.is_verified then null else (l.issued_on + interval '6 months')::date end$o$,
       $n$case when public.police_certificate_age_applies(t.id) then (l.issued_on + interval '6 months')::date end$n$),
      ('public.my_verification_checklist()',
       $o$'counts_until', (v_police.issued_on + interval '6 months')::date) end);$o$,
       $n$'counts_until', case when public.police_certificate_age_applies(auth.uid()) then (v_police.issued_on + interval '6 months')::date end) end);$n$),
      ('public.tutor_onboarding_finished(uuid)',
       $o$and d.issued_on >= ((now() at time zone 'Africa/Johannesburg')::date - interval '6 months')::date)$o$,
       $n$and (not public.police_certificate_age_applies(p_tutor) or d.issued_on >= ((now() at time zone 'Africa/Johannesburg')::date - interval '6 months')::date))$n$),
      ('public.admin_review_document(uuid,text,text,date)',
       $o$if v_issued < v_oldest then$o$,
       $n$if v_issued < v_oldest and public.police_certificate_age_applies(v_tutor) then$n$)
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(e.fn::regprocedure);
    v_hits := (length(v_def) - length(replace(v_def, e.old_text, ''))) / length(e.old_text);
    if v_hits <> 1 then
      raise exception 'police_age_one_rule: % expected the old text once, found %', e.fn, v_hits;
    end if;
    execute replace(v_def, e.old_text, e.new_text);
  end loop;
end
$patch$;
