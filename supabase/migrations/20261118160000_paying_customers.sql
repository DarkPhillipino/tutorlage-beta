-- 18 Nov 2026, SHOULD batch A item 5 (the CEO's rule of 16 Nov: the promo ends at 10,000 PAYING CUSTOMERS; the admin switches the codes off by hand). Purely ADDITIVE: one small table, two new functions.
-- No existing function, policy, grant, setting or row is changed, and no money or wallet function is touched.
--
-- "PAYING CUSTOMER" (PM wording, 18 Nov): a profile that has a CREDITED top-up (wallet_topups.status = 'successful') or has paid for a request that a tutor ACCEPTED
-- (session_requests.status = 'accepted' and payment_status 'paid' or 'wallet_paid', not a free session), counted ONCE however many times they paid. The payer of a request is
-- requested_by_profile_id (the parent, or the learner who pays for themself). NEVER counted: the CEO's own accounts and any other account an admin has put in
-- paying_customer_exclusions, review/Demo accounts (review_accounts), staff who may use the online-payment test (wallet_online_staff), and admin accounts (admin_profiles).
--
--   NEW table    paying_customer_exclusions       profile_id + reason: accounts that must never be counted (the CEO's own parent and learner accounts). No policy, no right for any API
--                                                  role; written by the PM or the programmer on the CEO's word (one insert), read only by the function below.
--   NEW function paying_customer_ids()            internal (nobody can call it): the distinct profile ids that count.
--   NEW function admin_paying_customers()         finance manager or super admin (the people who see the Codes page): the count, where it came from, how many accounts are excluded, how many
--                                                  promo codes are still switched on, the two thresholds (warn at 9,500, end at 10,000) and the state ('ok', 'warn', 'end').
-- The count NEVER switches anything off: when it reaches 10,000 the admin turns the codes off on the Codes page. It names nobody.
-- Rollback: Drake/programmer/rollbacks/20261118160000_paying_customers_ROLLBACK.sql

create table if not exists public.paying_customer_exclusions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 1 and 200),
  added_at timestamptz not null default now()
);
alter table public.paying_customer_exclusions enable row level security;
revoke all on table public.paying_customer_exclusions from public, anon, authenticated, service_role;

create or replace function public.paying_customer_ids()
returns table (profile_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with payers as (
    select t.profile_id as pid from public.wallet_topups t where t.status = 'successful'
    union
    select q.requested_by_profile_id from public.session_requests q
     where q.status = 'accepted' and q.payment_status in ('paid', 'wallet_paid') and coalesce(q.free_session, false) = false
  )
  select p.pid from payers p
   where p.pid is not null
     and not exists (select 1 from public.review_accounts r where r.user_id = p.pid)
     and not exists (select 1 from public.wallet_online_staff s where s.profile_id = p.pid)
     and not exists (select 1 from public.admin_profiles a where a.id = p.pid)
     and not exists (select 1 from public.paying_customer_exclusions x where x.profile_id = p.pid);
$$;
revoke all on function public.paying_customer_ids() from public, anon, authenticated, service_role;

create or replace function public.admin_paying_customers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c_warn constant integer := 9500;
  c_end constant integer := 10000;
  n integer;
  n_top integer;
  n_req integer;
  n_excl integer;
  n_codes integer;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.admin_role_in(array['finance_manager', 'super_admin']) then
    raise exception 'Only a finance manager or a super admin can see this' using errcode = '42501';
  end if;
  select count(*) into n from public.paying_customer_ids();
  select count(*) into n_top from public.paying_customer_ids() i
   where exists (select 1 from public.wallet_topups t where t.profile_id = i.profile_id and t.status = 'successful');
  select count(*) into n_req from public.paying_customer_ids() i
   where exists (select 1 from public.session_requests q where q.requested_by_profile_id = i.profile_id and q.status = 'accepted'
                   and q.payment_status in ('paid', 'wallet_paid') and coalesce(q.free_session, false) = false);
  select count(*) into n_excl from public.paying_customer_exclusions;
  select count(*) into n_codes from public.promo_codes c where c.active and (c.valid_until is null or c.valid_until > now());
  return jsonb_build_object(
    'count', n,
    'from_topups', n_top,
    'from_requests', n_req,
    'excluded_accounts', n_excl,
    'active_codes', n_codes,
    'warn_at', c_warn,
    'end_at', c_end,
    'state', case when n >= c_end then 'end' when n >= c_warn then 'warn' else 'ok' end
  );
end;
$$;
revoke all on function public.admin_paying_customers() from public, anon, service_role;
grant execute on function public.admin_paying_customers() to authenticated;
