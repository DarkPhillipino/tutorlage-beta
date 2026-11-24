-- Rolled-back test of migration 20261124240000_public_page_on_by_default.sql (JOB ON-BY-DEFAULT, 24 Nov 2026). NEEDS THE RUNNER (scripts/run-rolled-back-test.mjs, migration plus this file): the last line raises so everything is undone.
-- Made-up tutors only.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); tc uuid := gen_random_uuid(); td uuid := gen_random_uuid();
  ca text; row_a record; n int; nfail int; nlines int; v_body text;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x, z, 'authenticated', 'authenticated', 'pd.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb, tc, td]) x;
    update profiles set full_name = 'Tessa Surnamesson' where id = ta;
    -- tutors that are not verified yet: no page, no notice
    r := r || pg_temp.chk('A1', 'not verified: no page row and no notice', (select count(*) from tutor_public_profile where tutor_id = ta)::text || '/' || (select count(*) from notifications where profile_id = ta and type = 'public_page_live')::text, '0/0');

    -- B. verified with a code: page ON by default, honest basis, one notice with the link
    update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A' where id = any (array[ta, tb, tc, td]);
    update tutor_profiles set current_sub_tier_id = '4C' where id = tc;
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZPD' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb, tc, td]) x
       where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    -- td has chosen before: she switched her page off earlier
    insert into tutor_public_profile (tutor_id, is_public, withdrawn_at, basis) values (td, false, now(), 'earlier choice');
    update tutor_profiles set is_verified = true where id = any (array[ta, tb, tc, td]);
    select code into ca from promo_codes where owner_tutor_id = ta and active order by created_at limit 1;
    select * into row_a from tutor_public_profile where tutor_id = ta;
    r := r || pg_temp.chk('B1', 'her page is on, consent not claimed, basis says Terms Part B', (row_a.is_public and row_a.consent_at is null and row_a.withdrawn_at is null and row_a.basis like 'default on under Terms Part B%' and row_a.basis_at is not null)::text, 'true');
    select n2.body into v_body from notifications n2 where n2.profile_id = ta and n2.type = 'public_page_live';
    r := r || pg_temp.chk('B2', 'one bell notice with her link and the switch-off line, no surname', ((select count(*) from notifications where profile_id = ta and type = 'public_page_live') = 1 and v_body like '%https://tutorlage.com/t/' || ca || '%' and v_body like '%switch it off any time on your Teach screen%' and v_body not ilike '%surnamesson%')::text, 'true');
    r := r || pg_temp.chk('B3', 'the public page really opens (first name only)', (pg_temp.run_as(ta, format('select (public.public_tutor_page(%L)->>''first_name'')', ca))), 'Tessa');
    r := r || pg_temp.chk('B4', 'only one notice exists for her', (select count(*) from notifications where profile_id = ta and type = 'public_page_live')::text, '1');
    r := r || pg_temp.chk('B5', 'a level the page cannot show (4C): no page, no notice', (select count(*) from tutor_public_profile where tutor_id = tc)::text || '/' || (select count(*) from notifications where profile_id = tc and type = 'public_page_live')::text, '0/0');
    r := r || pg_temp.chk('B6', 'a tutor who had switched off earlier is not switched back on', (select is_public::text || '/' || basis from tutor_public_profile where tutor_id = td) || '/' || (select count(*) from notifications where profile_id = td and type = 'public_page_live')::text, 'false/earlier choice/0');

    -- C. she switches off: hidden at once and recorded; switching on again is her act and fills consent
    perform pg_temp.run_as(ta, 'select public.set_my_public_profile(false)::text');
    select * into row_a from tutor_public_profile where tutor_id = ta;
    r := r || pg_temp.chk('C1', 'switched off: not public, withdrawn recorded, page gone', (not row_a.is_public and row_a.withdrawn_at is not null)::text || '/' || pg_temp.run_as(ta, format('select coalesce(public.public_tutor_page(%L)::text, ''null'')', ca)), 'true/null');
    perform pg_temp.run_as(ta, 'select public.set_my_public_profile(true)::text');
    select * into row_a from tutor_public_profile where tutor_id = ta;
    r := r || pg_temp.chk('C2', 'switched on again by her: consent filled, basis says the tick, withdrawal cleared', (row_a.is_public and row_a.consent_at is not null and row_a.withdrawn_at is null and row_a.basis = 'switched on by the tutor, after the tick')::text, 'true');

    -- D. the existing company-switched pages (production rows only; none on a database without them)
    select count(*) into n from tutor_public_profile where tutor_id in ('847d3f13-7c3c-46a4-92a5-34026a90f1aa', '3379c014-33ed-4833-92da-28242b20cc81');
    r := r || pg_temp.chk('D1', 'Odi and Amira: honest basis and no consent claimed (counted where they exist)', (select count(*) filter (where basis like 'switched on by the company on the CEO%' and consent_at is null and is_public)::text || 'of' || n::text from tutor_public_profile where tutor_id in ('847d3f13-7c3c-46a4-92a5-34026a90f1aa', '3379c014-33ed-4833-92da-28242b20cc81')), n::text || 'of' || n::text);
    r := r || pg_temp.chk('D2', 'the trigger function is not callable by the app', has_function_privilege('authenticated', 'public.tutor_public_page_on_verified()', 'execute')::text || '/' || has_function_privilege('anon', 'public.tutor_public_page_on_verified()', 'execute')::text, 'false/false');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
