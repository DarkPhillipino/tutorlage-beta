-- 16 Nov 2026 (PM, item 6): the public webhook address is probed by callers that send NO signature headers at all (426 rows on production since 13 Nov,
-- 4 / 79 / 90 / 242 a day, all "Failed the safety check (missing_header); message without an id", plus a bell notice to finance every hour).
-- Nothing signed, nothing credited: it is noise. This changes ONLY wallet_online_record_event (service role only, called by the Worker):
--   * a rejected message whose detail says (missing_header): recorded at most ONCE an hour, never alerts finance, and such rows older than 7 days are deleted
--     (so the table keeps about 168 of them at most);
--   * every other rejected reason (a wrong signature, an old timestamp, an unreadable body) behaves exactly as before: at most 20 an hour, one alert an hour.
--     The missing_header rows no longer use up that allowance of 20, so a real bad-signature message is never crowded out.
-- The Worker is NOT changed: no Worker deploy is needed for this. Signatures, grants and every other function are untouched.
create or replace function public.wallet_online_record_event(p_provider text, p_source text, p_event_id text, p_outcome text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prov text := lower(btrim(coalesce(p_provider, '')));
  v_id bigint;
begin
  if v_prov = '' then
    raise exception 'Say which provider' using errcode = '22023';
  end if;
  if p_outcome not in ('rejected', 'needs_review', 'ignored') then
    raise exception 'That outcome cannot be recorded here' using errcode = '22023';
  end if;
  if p_source not in ('webhook', 'status_check') then
    raise exception 'Unknown source' using errcode = '22023';
  end if;
  -- A probe with no signature headers: quiet. At most one row an hour, no alert, nothing kept beyond 7 days.
  if p_outcome = 'rejected' and position('(missing_header)' in coalesce(p_detail, '')) > 0 then
    delete from public.wallet_provider_events e
     where e.outcome = 'rejected' and position('(missing_header)' in coalesce(e.detail, '')) > 0 and e.created_at < now() - interval '7 days';
    if exists (select 1 from public.wallet_provider_events e
                where e.outcome = 'rejected' and position('(missing_header)' in coalesce(e.detail, '')) > 0 and e.created_at > now() - interval '1 hour') then
      return jsonb_build_object('recorded', false, 'why', 'quiet');
    end if;
    v_id := public.wallet_online_log(v_prov, p_source, p_event_id, null, null, null, null, null, null, p_outcome, p_detail, false);
    return jsonb_build_object('recorded', v_id is not null, 'id', v_id);
  end if;
  if p_outcome = 'rejected' and (select count(*) from public.wallet_provider_events e
                                  where e.outcome = 'rejected' and position('(missing_header)' in coalesce(e.detail, '')) = 0 and e.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('recorded', false, 'why', 'capped');
  end if;
  v_id := public.wallet_online_log(v_prov, p_source, p_event_id, null, null, null, null, null, null, p_outcome, p_detail, false);
  if v_id is not null and p_outcome = 'rejected' and not exists (select 1 from public.notifications n where n.type = 'wallet_online_rejected' and n.created_at > now() - interval '1 hour') then
    perform public.wallet_notify_finance('wallet_online_rejected', 'A message to the online payment address was refused',
      format('It failed the safety check (%s). Nothing was credited. If this keeps happening, tell the programmer.', left(coalesce(nullif(btrim(p_detail), ''), 'no reason'), 100)));
  elsif v_id is not null and p_outcome = 'needs_review' then
    perform public.wallet_notify_finance('wallet_online_review', 'An online payment needs a person',
      format('%s. Look at it in the admin app (Payments, Wallets).', left(coalesce(nullif(btrim(p_detail), ''), 'no reason'), 300)));
  end if;
  return jsonb_build_object('recorded', v_id is not null, 'id', v_id);
end;
$$;
