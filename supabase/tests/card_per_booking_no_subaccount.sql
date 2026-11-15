-- Run AFTER the migration inside one rolled-back transaction (the last line raises on purpose; the message holds the results).
do $t$
declare d text := pg_get_functiondef('public.claim_session_request(uuid,uuid)'::regprocedure); r text := '';
begin
  r := r || 'N1 subaccount demand gone: ' || (position('Add your bank details' in d) = 0)::text || E'\n';
  r := r || 'N2 marker present: ' || (position('CARD PER BOOKING' in d) > 0)::text || E'\n';
  r := r || 'N3 wallet/free/paid-up-front branches kept: ' || (position('create_free_session' in d) > 0 and position('create_session_from_request' in d) > 0)::text || E'\n';
  r := r || 'N4 card vault checks kept: ' || (position('any more' in d) > 0 and position('paystack_fee_bearer' in d) > 0)::text || E'\n';
  r := r || 'N5 charge mode still returned: ' || (position('''mode'', ''charge''' in d) > 0)::text || E'\n';
  raise exception E'RESULTS\n%', r;
end $t$;
