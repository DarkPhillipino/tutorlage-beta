-- 18 Nov 2026 (item 13 of the road to P5): the daily retention job's wallet category refused to run on production, because the online top-ups of 9 Nov added two foreign keys to
-- wallet_topups that the job did not know about (wallet_online_attempts.topup_id, cascade; wallet_provider_events.topup_id, set null), and 'awaiting_payment' is a new open state.
-- The job is switched OFF (retention_jobs_enabled = false), so nothing has been deleted or skipped wrongly; this makes it safe to switch on.
-- Two changes to retention_run_wallet_records(), made on the LIVE text (so nothing else in it can drift), each checked to have really changed something:
--   1. the foreign-key allow-list for wallet_topups now names the two keys (still refuses any OTHER new key);
--   2. a wallet with an 'awaiting_payment' online top-up is not purged (it counts as open, like awaiting_proof and proof_sent).
-- Additive: no table, column or setting changes. Rolled back by restoring the old text (Drake/programmer/rollbacks).
do $m$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.retention_run_wallet_records()'::regprocedure);
  v_new := replace(v_def,
    $a$retention_assert_foreign_keys('public.wallet_topups', '{}'::text[])$a$,
    $b$retention_assert_foreign_keys('public.wallet_topups', array['wallet_online_attempts.topup_id:c', 'wallet_provider_events.topup_id:n'])$b$);
  if v_new = v_def then
    raise exception 'retention_run_wallet_records: the foreign-key line was not found, nothing changed';
  end if;
  v_def := v_new;
  v_new := replace(v_def,
    $a$t.profile_id = x.profile_id and t.status in ('awaiting_proof', 'proof_sent')$a$,
    $b$t.profile_id = x.profile_id and t.status in ('awaiting_proof', 'proof_sent', 'awaiting_payment')$b$);
  if v_new = v_def then
    raise exception 'retention_run_wallet_records: the open-top-up line was not found, nothing changed';
  end if;
  execute v_new;
end
$m$;
