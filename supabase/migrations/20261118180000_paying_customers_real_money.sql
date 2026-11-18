-- 18 Nov 2026, SHOULD batch A follow-up (PM decision 18 Nov: admin credits must not make anyone a paying customer). New versions of paying_customer_ids() and admin_paying_customers()
-- (both created by 20261118160000 earlier the same day); nothing else changes: same table, same rights, same answer shape.
-- RULE NOW: a paying customer is a profile with at least one CREDITED TOP-UP (wallet_topups.status = 'successful': an online bank payment or an EFT an admin confirmed against the proof,
-- both real money; an admin's gift or correction is a wallet 'adjustment' in the ledger and never a top-up row) or a request paid by CARD that a tutor ACCEPTED (payment_status = 'paid').
-- A request paid from the wallet ('wallet_paid') is NO LONGER counted by itself: the wallet may hold an admin gift or a refund, so it counts only through the payer's own credited top-up.
-- Still never counted: review/Demo accounts, online-payment staff, admin accounts, accounts in paying_customer_exclusions, free sessions.
-- Rollback: Drake/programmer/rollbacks/20261118180000_paying_customers_real_money_ROLLBACK.sql (puts the 20261118160000 versions back).

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
     where q.status = 'accepted' and q.payment_status = 'paid' and coalesce(q.free_session, false) = false
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
                   and q.payment_status = 'paid' and coalesce(q.free_session, false) = false);
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
