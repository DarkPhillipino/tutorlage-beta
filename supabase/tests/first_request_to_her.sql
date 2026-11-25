-- Rolled-back test of migration 20261124220000_first_request_to_her.sql (JOB JOURNEY, 24 Nov 2026). Run TOGETHER with the migration through scripts/run-rolled-back-test.mjs;
-- the last line raises so everything is undone. Made-up people only.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); lrn uuid := gen_random_uuid(); lr2 uuid := gen_random_uuid();
  ca text; cid uuid; j jsonb; nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then perform set_config('request.jwt.claims', '', true); set local role anon;
        else perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated; end if;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x, z, 'authenticated', 'authenticated', 'fr.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb]) x;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x, z, 'authenticated', 'authenticated', 'fr.l.' || x || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}' from unnest(array[lrn, lr2]) x;
    update profiles set full_name = 'Tessa Surnamesson' where id = ta;
    update profiles set full_name = 'Bongani Dlamini' where id = tb;
    update tutor_profiles set is_verified = true, current_tier_id = 1, current_sub_tier_id = '1A' where id = any (array[ta, tb]);
    -- since 24 Nov 2026 (JOB ON-BY-DEFAULT) approval itself switches the page on; this suite starts from "page off", so remove the rows approval made (rolled back with everything else)
    delete from tutor_public_profile where tutor_id = any (array[ta, tb]);
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZFR' || substr(replace(x::text, '-', ''), 1, 8), 'zz test', 10, 3, true, x from unnest(array[ta, tb]) x
       where not exists (select 1 from promo_codes c where c.owner_tutor_id = x);
    select id, code into cid, ca from promo_codes where owner_tutor_id = ta;

    -- A. nothing attached, nothing linked
    r := r || pg_temp.chk('A1', 'a learner with no code: no linked tutor', pg_temp.run_as(lrn, 'select coalesce(public.my_linked_tutor()::text, ''null'')'), 'null');
    r := r || pg_temp.chk('A2', 'an ordinary request to a tutor never met is still refused', pg_temp.run_as(lrn, format('select public.addressed_request_problem(%L, %L, %L, null, null, null)', lrn, lrn, ta)), 'You can only ask for a tutor you have had a session with.');
    r := r || pg_temp.chk('A3', 'a visitor who is not signed in cannot ask', left(pg_temp.run_as(null, 'select public.my_linked_tutor()::text'), 30), 'ERR: permission denied for fun');

    -- B. the code of a tutor whose page is OFF links nobody
    update profiles set promo_code_id = cid, promo_code_entered = ca, promo_attached_at = now() where id = lrn;
    r := r || pg_temp.chk('B1', 'her page is off: no linked tutor', pg_temp.run_as(lrn, 'select coalesce(public.my_linked_tutor()::text, ''null'')'), 'null');
    r := r || pg_temp.chk('B2', 'her page is off: the request to her is still refused', pg_temp.run_as(lrn, format('select public.addressed_request_problem(%L, %L, %L, null, null, null)', lrn, lrn, ta)), 'You can only ask for a tutor you have had a session with.');

    -- C. her page on: her family's first request can be addressed to her
    insert into tutor_public_profile (tutor_id, is_public, consent_at) values (ta, true, now()) on conflict (tutor_id) do update set is_public = true, consent_at = now(), withdrawn_at = null;
    j := (pg_temp.run_as(lrn, 'select public.my_linked_tutor()::text'))::jsonb;
    r := r || pg_temp.chk('C1', 'the linked tutor is her: id, first name and (since 25 Nov 2026) working hours in words', ((j ->> 'tutor_id') = ta::text and (j ->> 'first_name') = 'Tessa' and (j ? 'hours') and (j ? 'code') and (select count(*) from jsonb_object_keys(j)) = 4 and j::text not ilike '%surnamesson%')::text, 'true');
    r := r || pg_temp.chk('C2', 'the request addressed to her is allowed', pg_temp.run_as(lrn, format('select coalesce(public.addressed_request_problem(%L, %L, %L, null, null, null), ''allowed'')', lrn, lrn, ta)), 'allowed');
    r := r || pg_temp.chk('C3', 'a request to a DIFFERENT tutor is still refused', pg_temp.run_as(lrn, format('select public.addressed_request_problem(%L, %L, %L, null, null, null)', lrn, lrn, tb)), 'You can only ask for a tutor you have had a session with.');
    r := r || pg_temp.chk('C4', 'since 25 Nov 2026 a learner with no code may address her too, while her page is on', pg_temp.run_as(lr2, format('select coalesce(public.addressed_request_problem(%L, %L, %L, null, null, null), ''allowed'')', lr2, lr2, ta)), 'allowed');
    r := r || pg_temp.chk('C5', 'a level above hers is refused as before', (pg_temp.run_as(lrn, format('select public.addressed_request_problem(%L, %L, %L, %L, null, null)', lrn, lrn, ta, (select id from sub_tier_definitions order by max_allowed_rate desc limit 1))) like 'This tutor teaches at a lower price level%')::text, 'true');
    r := r || pg_temp.chk('C6', 'she herself has no linked tutor', pg_temp.run_as(ta, 'select coalesce(public.my_linked_tutor()::text, ''null'')'), 'null');
    r := r || pg_temp.chk('C7', 'the call is open to a signed-in person only', has_function_privilege('authenticated', 'public.my_linked_tutor()', 'execute')::text || '/' || has_function_privilege('anon', 'public.my_linked_tutor()', 'execute')::text, 'true/false');

    -- D. she switches off, stops being verified, or the code is switched off: general matching again
    update tutor_public_profile set is_public = false where tutor_id = ta;
    r := r || pg_temp.chk('D1', 'she switches her page off: not linked, not allowed', pg_temp.run_as(lrn, 'select coalesce(public.my_linked_tutor()::text, ''null'')') || '/' || left(pg_temp.run_as(lrn, format('select public.addressed_request_problem(%L, %L, %L, null, null, null)', lrn, lrn, ta)), 24), 'null/You can only ask for a t');
    update tutor_public_profile set is_public = true where tutor_id = ta;
    update tutor_profiles set is_verified = false where id = ta;
    r := r || pg_temp.chk('D2', 'no longer verified: not linked', pg_temp.run_as(lrn, 'select coalesce(public.my_linked_tutor()::text, ''null'')'), 'null');
    update tutor_profiles set is_verified = true where id = ta;
    update promo_codes set active = false where id = cid;
    r := r || pg_temp.chk('D3', 'her code switched off: not linked', pg_temp.run_as(lrn, 'select coalesce(public.my_linked_tutor()::text, ''null'')'), 'null');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
