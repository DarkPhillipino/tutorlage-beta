-- CARD PAYMENT PER BOOKING (CEO, 15 Nov 2026): a card pays one booking and settles to Tutorlage's own account; no splits, no subaccounts.
-- The tutor's share is credited to the tutor wallet at completion (wallet_credit_card_session) and paid out on request.
-- This one change: claim_session_request no longer asks for a tutor bank account / Paystack subaccount before accepting a paid request.
-- Everything else in the function is kept word for word (patched in place, so it stays correct whichever earlier migration last defined it).
do $mig$
declare
  v_def text;
  v_new text;
  v_old constant text := E'  select paystack_subaccount_code into v_subaccount\n  from public.tutor_payout_accounts where tutor_id = p_tutor_id;\n  if v_subaccount is null then\n    raise exception ''Add your bank details in your tutor account before accepting paid requests — that''''s where your share is paid.'';\n  end if;\n';
begin
  v_def := pg_get_functiondef('public.claim_session_request(uuid,uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then
    if position('CARD PER BOOKING' in v_def) > 0 then return; end if;   -- already applied
    raise exception 'claim_session_request: subaccount block not found, nothing changed';
  end if;
  v_new := replace(v_def, v_old, E'  v_subaccount := null;   -- CARD PER BOOKING (CEO, 15 Nov 2026): no tutor subaccount; the money settles to Tutorlage and is credited at completion\n');
  execute v_new;
end
$mig$;
