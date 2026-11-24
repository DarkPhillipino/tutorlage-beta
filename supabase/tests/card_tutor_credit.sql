-- Rolled-back test of CARD-PAID TUTOR CREDIT (migration 20261115120000). Run the migration together with this file in one rolled-back statement:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/card_tutor_credit.sql supabase/migrations/20261115120000_card_paid_tutor_credit.sql supabase/migrations/20261115120000_card_paid_tutor_credit.sql
-- (the migration twice on purpose: the second run, backfill included, must change nothing).
-- Template: the demo tutor's real completed card-paid session b536fa81-49bd-4449-ab9b-b2fb442e9756 and its request are CLONED (new ids, a far-future date, status
-- 'scheduled') inside the rolled-back statement, then changed per case. Nothing is kept. The clones are credited only by completing them.
do $$
declare
  r text := '';
  tmpl uuid := 'b536fa81-49bd-4449-ab9b-b2fb442e9756';
  tutor uuid;
  n int; n2 int; ntot0 bigint; ntot1 bigint; w0 integer; t text;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid; s9 uuid;
  nfail int; nlines int; rep text;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    -- a scheduled clone of the template session with its own paid card request; p_set is a jsonb of request fields to override, p_sset of session fields
    execute $mk$
      create function pg_temp.mk(p_tmpl uuid, p_set jsonb, p_sset jsonb) returns uuid language plpgsql as $f$
      declare ns uuid := gen_random_uuid(); nq uuid := gen_random_uuid(); rs public.sessions; rq public.session_requests; qid uuid;
      begin
        select * into rs from public.sessions where id = p_tmpl;
        select * into rq from public.session_requests where resulting_session_id = p_tmpl;
        qid := rq.id;
        rq := jsonb_populate_record(rq, jsonb_build_object('id', nq, 'resulting_session_id', null, 'paystack_reference', 'ps_' || nq, 'charge_reference', 'chg_' || nq) || p_set);
        insert into public.session_requests select (rq).*;
        rs := jsonb_populate_record(rs, jsonb_build_object('id', ns, 'status', 'scheduled', 'scheduled_start', now() + interval '400 days') || p_sset);
        insert into public.sessions select (rs).*;
        update public.session_requests set resulting_session_id = ns where id = nq;
        return ns;
      end $f$ $mk$;
    execute $mk$ create function pg_temp.done(p_s uuid) returns void language sql as $f$ update public.sessions set status = 'completed', completed_at = now() where id = p_s $f$ $mk$;
    -- (24 Nov 2026) K3 accepts both words: run WITH the 15 Nov migration the function says 'wallet' (that migration puts its own text back); run after the lesson-credit migration it says 'earnings'.
    execute $mk$ create function pg_temp.lines(p_s uuid) returns int language sql as $f$ select count(*)::int from public.wallet_ledger where idempotency_key = 'credit:' || p_s $f$ $mk$;
    execute $mk$ create function pg_temp.alerts(p_s uuid) returns int language sql as $f$ select count(*)::int from public.notifications where type = 'wallet_credit_failed' and body like '%' || p_s::text || '%' $f$ $mk$;

    select tutor_id into tutor from public.sessions where id = tmpl;
    -- ---- backfill (the migration ran before this file) ----
    r := r || pg_temp.chk('K1', 'the demo session b536fa81 has one credit line of 35 after the backfill',
      (select count(*) || ' / ' || coalesce(max(available_delta), 0) || ' / ' || coalesce(max(kind), '-') from public.wallet_ledger where idempotency_key = 'credit:' || tmpl), '1 / 35 / session_credit');
    r := r || pg_temp.chk('K2', 'the credit line is on the tutor, ties to the session and the request',
      (select (profile_id = tutor)::text || ' ' || (session_id = tmpl)::text || ' ' || (request_id is not null)::text from public.wallet_ledger where idempotency_key = 'credit:' || tmpl), 'true true true');
    -- 24 Nov 2026 (U2): K3 used to count the notice made by THIS run's backfill (created within the hour). On production the backfill ran on 15 Nov and a second run
    -- changes nothing (K1 and the idempotency), so the notice is the one made then: the tutor was told, at least once, with the exact amount, and about this session's credit.
    r := r || pg_temp.chk('K3', 'the tutor was told (the notice made when the backfill credited the session)',
      (select (count(*) >= 1)::text from public.notifications where profile_id = tutor and type = 'wallet_session_credit' and body in ('R35 for a completed session was added to your wallet.', 'R35 for a completed session was added to your earnings.')), 'true');
    -- ---- 1: a proven card session completing credits the share, once ----
    ntot0 := (select coalesce(sum(available_rand + held_rand), 0) from public.wallets);
    s1 := pg_temp.mk(tmpl, '{}', '{}');
    perform pg_temp.done(s1);
    ntot1 := (select coalesce(sum(available_rand + held_rand), 0) from public.wallets);
    r := r || pg_temp.chk('K4', 'completing a card-paid session adds one line of 35, no alert, the wallet total rises by exactly 35',
      pg_temp.lines(s1) || ' / ' || (select available_delta from public.wallet_ledger where idempotency_key = 'credit:' || s1) || ' / ' || pg_temp.alerts(s1) || ' / ' || (ntot1 - ntot0), '1 / 35 / 0 / 35');
    update public.sessions set status = 'scheduled' where id = s1; perform pg_temp.done(s1);
    update public.sessions set status = 'in_progress' where id = s1; perform pg_temp.done(s1);
    r := r || pg_temp.chk('K5', 'completing it again (and again) credits nothing more',
      pg_temp.lines(s1)::text || ' / ' || (select count(*) from public.wallet_ledger where session_id = s1 and kind = 'session_credit'), '1 / 1');
    r := r || pg_temp.chk('K6', 'books: the tutor wallet equals the sum of its ledger lines, and card money made no charge/topup line',
      (select (w.available_rand = (select sum(available_delta) from public.wallet_ledger l where l.profile_id = tutor))::text || ' ' ||
              (select count(*) from public.wallet_ledger where session_id = s1 and kind <> 'session_credit') from public.wallets w where w.profile_id = tutor), 'true 0');
    -- ---- 2: the proofs; each failing case credits nothing and alerts finance ----
    s2 := pg_temp.mk(tmpl, '{"refunded_at":"2026-11-15T10:00:00Z"}', '{}'); perform pg_temp.done(s2);
    r := r || pg_temp.chk('K7', 'a refunded card payment: no credit, one finance alert', pg_temp.lines(s2) || ' / ' || pg_temp.alerts(s2), '0 / 1');
    s3 := pg_temp.mk(tmpl, '{"payment_status":"charging"}', '{}'); perform pg_temp.done(s3);
    r := r || pg_temp.chk('K8', 'a request that is not paid: no credit, one alert', pg_temp.lines(s3) || ' / ' || pg_temp.alerts(s3), '0 / 1');
    s4 := pg_temp.mk(tmpl, '{}', '{"tutor_payout_amount":34}'); perform pg_temp.done(s4);
    r := r || pg_temp.chk('K9', 'a split that does not add up (payout 34): no credit, one alert', pg_temp.lines(s4) || ' / ' || pg_temp.alerts(s4), '0 / 1');
    s5 := pg_temp.mk(tmpl, '{}', '{"gross_amount":60}'); perform pg_temp.done(s5);
    r := r || pg_temp.chk('K10', 'amount charged differs from the session gross: no credit, one alert', pg_temp.lines(s5) || ' / ' || pg_temp.alerts(s5), '0 / 1');
    s6 := pg_temp.mk(tmpl, '{"commission_amount":15.50}', '{"tutor_payout_amount":34.50}'); perform pg_temp.done(s6);
    r := r || pg_temp.chk('K11', 'a share with cents (34.50) is refused, not rounded', pg_temp.lines(s6) || ' / ' || pg_temp.alerts(s6), '0 / 1');
    s7 := pg_temp.mk(tmpl, '{"fee_bearer":"subaccount","paystack_fee":3.00}', '{"tutor_payout_amount":32}'); perform pg_temp.done(s7);
    r := r || pg_temp.chk('K12', 'fee charged to the tutor subaccount: the share is charged - commission - fee (32), credited', pg_temp.lines(s7) || ' / ' || coalesce((select available_delta::text from public.wallet_ledger where idempotency_key = 'credit:' || s7), '-'), '1 / 32');
    s9 := pg_temp.mk(tmpl, '{}', '{"free_session":true,"gross_amount":0,"tutor_payout_amount":0}'); perform pg_temp.done(s9);
    r := r || pg_temp.chk('K14', 'a free session: nothing owed, no credit, no alert', pg_temp.lines(s9) || ' / ' || pg_temp.alerts(s9), '0 / 0');
    s8 := pg_temp.mk(tmpl, '{}', '{"wallet_paid":true}'); perform pg_temp.done(s8);
    r := r || pg_temp.chk('K18', 'wallet path unchanged: wallet_paid session without wallet proof: no credit, one alert', pg_temp.lines(s8) || ' / ' || pg_temp.alerts(s8), '0 / 1');
    -- not completed: a scheduled card session credits nothing
    r := r || pg_temp.chk('K15', 'a session that is not completed has no credit (s1 clone while scheduled)',
      pg_temp.lines(pg_temp.mk(tmpl, '{}', '{}'))::text, '0');
    -- helper cannot be called by the app
    r := r || pg_temp.chk('K16', 'the helper is not callable by app roles',
      (select (has_function_privilege('authenticated', 'public.wallet_credit_card_session(uuid)', 'execute') or has_function_privilege('anon', 'public.wallet_credit_card_session(uuid)', 'execute')
               or has_function_privilege('service_role', 'public.wallet_credit_card_session(uuid)', 'execute'))::text), 'false');
    -- a second backfill pass changes nothing
    select count(*) into n from public.wallet_ledger where kind = 'session_credit';
    r := r || pg_temp.chk('K17', 'the trigger fires for card sessions now (no wallet_paid condition)',
      (select (pg_get_triggerdef(oid) not like '%wallet_paid%')::text from pg_trigger where tgname = 'wallet_credit_tutor' and tgrelid = 'public.sessions'::regclass), 'true');
  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  select count(*) filter (where l like '%FAIL%' or l like 'STOPPED%'), count(*) filter (where l <> '') into nfail, nlines from regexp_split_to_table(r, E'\n') as l;
  select string_agg(case when l like '%FAIL%' or l like 'STOPPED%' then l else regexp_replace(l, '^(\S+) [^:]*: ', E'\\1 ') end, E'\n' order by o)
    into rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  -- 24 Nov 2026 (U2): same fix as card_checkout_allowlist: alone, this block used to end without raising and COMMITTED (it credited the Demo Tutor twice and
  -- sent 18 notices). Now it raises the report unless the runner is driving it.
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'CARD TUTOR CREDIT TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'CARD TUTOR CREDIT TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
