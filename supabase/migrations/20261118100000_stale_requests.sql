-- 18 Nov 2026, road to P5 items 31 and 3 (PM approved 17 Nov night). Additive: two new functions and one new scheduled job; no table, column, setting or existing function changes.
--
-- ITEM 31. expire_stale_initiated_requests(): a request starts as 'initiated' (the database stamps it so when the learner or guardian inserts it) and becomes 'card_verified' only when the
-- payment or the wallet hold or the free/promo step succeeds. If that step is never completed (the page was closed, the card sheet abandoned) the request stays pending for ever: 9 of
-- them on 17 Nov, all demo accounts, found by the road-to-P5 review. Nothing was paid or held for such a request (the hold and the charge both move it out of 'initiated'), no tutor
-- ever saw it (only funded requests reach a tutor), so it is simply cancelled after 60 minutes, quietly (no notice: the person abandoned it). 60 minutes is longer than the card sheet lives.
-- Runs every 5 minutes, at most 200 rows a time, skips rows another transaction is working on. The existing triggers on session_requests (wallet_release_hold, promo_return_use) run as for any cancel.
--
-- ITEM 3. admin_stale_requests(p_hours): read-only list for the admin app of FUNDED requests (pending, card_verified) that have waited p_hours (default 24) or more without a tutor accepting.
-- Admins only; no names, emails or phone numbers (the request id is the handle; the admin opens the request from the Payments or Sessions views). Used by the "request waiting 24 hours or
-- more" alert and the Phase 1 numbers page.

create or replace function public.expire_stale_initiated_requests()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with stale as (
    select q.id
    from public.session_requests q
    where q.status = 'pending'
      and q.payment_status = 'initiated'
      and q.created_at < now() - interval '60 minutes'
      and coalesce(q.paid_from_wallet, false) = false
      and coalesce(q.wallet_hold_rand, 0) = 0
    order by q.created_at
    limit 200
    for update skip locked
  )
  update public.session_requests r
     set status = 'cancelled', responded_at = now()
    from stale
   where r.id = stale.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.expire_stale_initiated_requests() from public, anon, authenticated, service_role;

create or replace function public.admin_stale_requests(p_hours integer default 24)
returns table (
  request_id uuid,
  created_at timestamptz,
  hours_waiting numeric,
  requested_start timestamptz,
  duration_hours numeric,
  addressed_to_one_tutor boolean,
  funding text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 0 or p_hours > 24 * 365 then
    raise exception 'Hours must be between 0 and 8760' using errcode = '22023';
  end if;
  return query
    select q.id,
           q.created_at,
           round((extract(epoch from (now() - q.created_at)) / 3600)::numeric, 1),
           q.requested_start,
           q.duration_hours::numeric,
           q.requested_tutor_id is not null,
           case when coalesce(q.free_session, false) then 'free' when coalesce(q.paid_from_wallet, false) then 'wallet' else 'card' end
    from public.session_requests q
    where q.status = 'pending'
      and q.payment_status = 'card_verified'
      and q.created_at <= now() - make_interval(hours => p_hours)
    order by q.created_at
    limit 200;
end;
$$;
revoke all on function public.admin_stale_requests(integer) from public, anon;
grant execute on function public.admin_stale_requests(integer) to authenticated;

-- every 5 minutes (re-running this file just updates the schedule)
select cron.schedule('expire-stale-initiated-requests', '*/5 * * * *', 'select public.expire_stale_initiated_requests();');
