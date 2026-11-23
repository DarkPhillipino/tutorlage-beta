-- Rolled-back test of migration 20261123220000_lesson_credit_wording.sql (job W, 23 Nov 2026): the database's user-visible texts say "credit" (parents and learners) and "earnings" (tutors), and nothing else about
-- those functions changed. Run it TOGETHER with the migration (one statement; the last line raises so everything is undone) or alone after the apply. Made-up people only; nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '35 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  u uuid := gen_random_uuid();
  t text; n int;
  old text[]; fn text;
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    -- A. none of the old user-visible sentences is left in any function, and the new ones are there
    select count(*)::text into t from pg_proc p where p.pronamespace = 'public'::regnamespace and (
         p.prosrc like '%back in your wallet%' or p.prosrc like '%added to your wallet%' or p.prosrc like '%taken from your wallet%' or p.prosrc like '%taken out of your wallet%'
      or p.prosrc like '%Your wallet was updated%' or p.prosrc like '%Your wallet has R%' or p.prosrc like '%take your wallet above%' or p.prosrc like '%money to a wallet%' or p.prosrc like '%hold in a wallet%'
      or p.prosrc like '%from your wallet. Open Sessions%' or p.prosrc like '%in your wallet as credit%' or p.prosrc like '%can only pay for requests in rand%' and p.prosrc not like '%Credit can only pay%');
    r := r || pg_temp.chk('A1', 'no function still holds an old user-visible "wallet" sentence', t, '0');
    r := r || pg_temp.chk('A2', 'the parents'' notice functions say credit', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('wallet_credit_topup', 'wallet_hold_for_request', 'admin_refund_to_wallet', 'create_wallet_session', 'closure_cancel_session')
      and (p.prosrc like '%to your credit%' or p.prosrc like '%Your credit has R%' or p.prosrc like '%from your credit%' or p.prosrc like '%back in your credit%')), '5');
    r := r || pg_temp.chk('A3', 'the tutors'' notice functions say earnings', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('wallet_credit_tutor', 'wallet_credit_card_session', 'tutor_bonus_pay', 'tutor_bonus_take_back', 'admin_mark_payout_cannot_pay')
      and p.prosrc like '%your earnings%'), '5');
    r := r || pg_temp.chk('A4', 'the decline and expiry notices say the price is back in the credit', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('decline_session_request', 'expire_stale_paid_requests') and p.prosrc like '%is back in your credit.%'), '2');
    -- B. the same functions are still there with the same rights
    r := r || pg_temp.chk('B1', 'the 18 functions exist and none is open to signed-out callers except where it was before (anon rights unchanged: none of them)', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
      ('admin_adjust_wallet','admin_mark_payout_cannot_pay','admin_refund_to_wallet','admin_return_wallet_money','closure_cancel_session','create_online_topup','create_wallet_topup','create_wallet_session','send_request_wallet','tutor_bonus_pay','tutor_bonus_take_back','wallet_credit_card_session','wallet_credit_tutor','wallet_credit_topup','wallet_hold_for_request','decline_session_request','expire_stale_paid_requests','cancel_session')
      and not has_function_privilege('anon', p.oid, 'execute')), '18');
    -- C. a real refusal reads right: a parent cannot take the credit above the cap
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (u, z, 'authenticated', 'authenticated', 'lc.' || uid || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pat', 'date_of_birth', adult), '{}');
    update public.system_settings set setting_value = '1500'::jsonb where setting_key = 'wallet_topup_max_rand';
    update public.system_settings set setting_value = '2000'::jsonb where setting_key = 'wallet_balance_cap_rand';
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.create_wallet_topup(1500);
    begin perform public.create_wallet_topup(1000); t := 'DONE'; exception when others then t := sqlerrm; end;
    reset role;
    r := r || pg_temp.chk('C1', 'above the cap: the refusal says credit and how much can still be added', t, 'That would take your credit above R2000. You can add up to R500 now.');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
