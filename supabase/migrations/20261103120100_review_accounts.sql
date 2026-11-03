-- Temporary review logins that delete themselves (CEO's request, 3 Nov 2026: logins for Paystack's reviewers, gone after 14 days).
-- Needs 20261103120000_review_accounts_audit_actions.sql committed first (it adds the two audit labels used below), the wallet core
-- (wallet_ledger, wallet_topups, payout_requests, wallets, wallet_notify_finance) and pg_cron (the migration fails loudly without it).
--   * review_accounts: one row per temporary account (user id, purpose, created_at, expires_at = 14 days after creation unless the tool says
--     otherwise). No foreign key (the sign-in it describes is deleted); the row stays afterwards with deleted_at, as the record that it went.
--     No browser role has any right to it; the server key (used by the tool the CEO runs) may read, add and remove rows.
--   * delete_expired_review_accounts(): runs every night at 02:40 UTC. For each registered account past its expiry:
--       - if it has ANY wallet ledger line, session, session request, document, payout request, top-up, problem report or stored file, it is NOT
--         deleted (this is real money or a real record). The finance managers and super admins get a notification, the audit log gets a
--         review_account_kept line, and the reminder repeats once a week while it stays;
--       - otherwise it is deleted: its sign-in, profile and everything that hangs off it (the foreign keys cascade; the few that do not are
--         deleted by hand first), an empty wallet row, and a review_account_deleted line is written to the audit log.
--     A made-up learner goes only when its guardian account is gone (if the guardian is kept, so is the learner, quietly).
--     Each account is handled in its own sub-transaction: any error undoes that one account, is shown in kept_reason, alerts, and the others
--     still run.
-- Additive: one table, four functions, one cron job. Nothing existing is changed.

create table if not exists public.review_accounts (
  user_id uuid primary key,
  purpose text not null check (purpose in ('parent', 'learner', 'tutor')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  deleted_at timestamptz,
  kept_reason text,
  last_alert_at timestamptz
);
comment on table public.review_accounts is
  'Temporary logins made for a payment provider''s reviewers; delete_expired_review_accounts() deletes them after expires_at. No personal data here.';
alter table public.review_accounts enable row level security;
revoke all on public.review_accounts from public, anon, authenticated, service_role;
grant select, insert, delete on public.review_accounts to service_role;

-- The audit line. No admin is acting (the nightly job runs as the owner), so admin_id stays empty. The action is text so the helper can be
-- created before the labels are committed.
create or replace function public.review_accounts_audit(p_action text, p_user uuid, p_meta jsonb)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.admin_audit_logs (admin_id, action, target_entity_type, target_entity_id, metadata)
  values (null, p_action::public.audit_action, 'review_account', p_user, coalesce(p_meta, '{}'::jsonb));
$$;

-- What stops a deletion: the first thing found, in words, or null when the account holds nothing we must keep.
create or replace function public.review_account_keep_reason(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hold boolean := false;
begin
  if exists (select 1 from public.wallet_ledger l where l.profile_id = p_user) then return 'a wallet ledger line'; end if;
  if exists (select 1 from public.wallet_topups t where t.profile_id = p_user) then return 'a wallet top-up'; end if;
  if exists (select 1 from public.payout_requests q where q.tutor_id = p_user) then return 'a payout request'; end if;
  if exists (select 1 from public.payouts po where po.tutor_id = p_user) then return 'a payout'; end if;
  if exists (select 1 from public.sessions s where p_user in (s.student_id, s.tutor_id, s.booked_by_profile_id)) then return 'a session'; end if;
  if exists (select 1 from public.session_requests r
             where p_user in (r.student_id, r.requested_by_profile_id, r.tutor_id, r.requested_tutor_id)) then return 'a session request'; end if;
  if exists (select 1 from public.tutor_verification_documents d where d.tutor_id = p_user) then return 'a verification document'; end if;
  if exists (select 1 from public.tier1_academic_records a where a.tutor_id = p_user) then return 'an academic record'; end if;
  if exists (select 1 from public.platform_disputes d where d.raised_by_id = p_user) then return 'a problem report'; end if;
  -- A stored file cannot be removed from plain SQL (the file itself would stay behind), so it keeps the account.
  if exists (select 1 from storage.objects o where split_part(o.name, '/', 1) = p_user::text or o.owner_id = p_user::text) then return 'a stored file'; end if;
  if to_regprocedure('public.profile_is_on_safety_hold(uuid)') is not null then
    execute 'select public.profile_is_on_safety_hold($1)' into v_hold using p_user;
    if coalesce(v_hold, false) then return 'a safety hold'; end if;
  end if;
  return null;
end;
$$;

-- Tells the finance managers and super admins that an expired account was kept, at most once a week per account, and writes the audit line.
-- A failure here never stops the nightly run (and the weekly clock only moves when the notice was written).
create or replace function public.review_account_raise_alert(p_user uuid, p_purpose text, p_expires timestamptz, p_last_alert timestamptz, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_last_alert is not null and p_last_alert > now() - interval '7 days' then
    return false;
  end if;
  begin
    perform public.wallet_notify_finance('review_account_kept', 'A temporary review login was not deleted',
      'The temporary ' || p_purpose || ' login ' || p_user || ' expired on ' || to_char(p_expires at time zone 'Africa/Johannesburg', 'DD Mon YYYY')
      || ' but was kept because it has ' || p_reason || '. Nothing was deleted. Decide what to do with it by hand; this reminder repeats once a week.');
    perform public.review_accounts_audit('review_account_kept', p_user,
      jsonb_build_object('purpose', p_purpose, 'expired_at', p_expires, 'reason', p_reason));
    update public.review_accounts set last_alert_at = now() where user_id = p_user;
    return true;
  exception when others then
    raise warning 'review account alert failed for %: %', p_user, sqlerrm;
    return false;
  end;
end;
$$;

-- The nightly job.
create or replace function public.delete_expired_review_accounts()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
  v_reason text;
  n_deleted integer := 0;
  n_kept integer := 0;
  n_errors integer := 0;
  n_alerts integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('delete_expired_review_accounts', 0)) then
    return jsonb_build_object('skipped', 'another run is in progress');
  end if;
  -- Parents first, then tutors, then learners (a learner waits for its guardian).
  for r in
    select ra.user_id, ra.purpose, ra.created_at, ra.expires_at, ra.last_alert_at
    from public.review_accounts ra
    where ra.deleted_at is null and ra.expires_at <= now()
    order by case ra.purpose when 'parent' then 1 when 'tutor' then 2 else 3 end, ra.user_id
  loop
    begin
      v_reason := public.review_account_keep_reason(r.user_id);
      if v_reason is null and r.purpose = 'learner'
         and exists (select 1 from public.parent_student_links l
                     join public.review_accounts g on g.user_id = l.parent_id and g.deleted_at is null
                     where l.student_id = r.user_id) then
        update public.review_accounts set kept_reason = 'its guardian account is still here' where user_id = r.user_id;
        n_kept := n_kept + 1;
        continue;
      end if;
      if v_reason is not null then
        update public.review_accounts set kept_reason = v_reason where user_id = r.user_id;
        n_kept := n_kept + 1;
        if public.review_account_raise_alert(r.user_id, r.purpose, r.expires_at, r.last_alert_at, v_reason) then
          n_alerts := n_alerts + 1;
        end if;
        continue;
      end if;

      -- Rows the foreign keys do not remove on their own.
      delete from public.messages where sender_id = r.user_id;
      delete from public.learner_tutor_choices where chosen_by = r.user_id;
      -- An empty wallet row (no foreign key; the ledger check above proved there is no line behind it).
      perform set_config('tutorlage.purging_wallet_ledger', 'on', true);
      delete from public.wallets where profile_id = r.user_id and available_rand = 0 and held_rand = 0;
      perform set_config('tutorlage.purging_wallet_ledger', 'off', true);
      -- The sign-in (its sessions and identities cascade) and the profile (everything else cascades; explicit in case the sign-in trigger is absent).
      delete from auth.users where id = r.user_id;
      delete from public.profiles where id = r.user_id;
      if exists (select 1 from auth.users u where u.id = r.user_id) or exists (select 1 from public.profiles p where p.id = r.user_id)
         or exists (select 1 from public.wallets w where w.profile_id = r.user_id) then
        raise exception 'something of the account is still there after deleting it';
      end if;
      perform public.review_accounts_audit('review_account_deleted', r.user_id,
        jsonb_build_object('purpose', r.purpose, 'created_at', r.created_at, 'expired_at', r.expires_at));
      update public.review_accounts set deleted_at = now(), kept_reason = null where user_id = r.user_id;
      n_deleted := n_deleted + 1;
    exception when others then
      -- This account's changes are undone; it stays, and the finance managers hear about it.
      perform set_config('tutorlage.purging_wallet_ledger', 'off', true);
      n_errors := n_errors + 1;
      v_reason := 'an error while deleting it (' || left(sqlerrm, 160) || ')';
      update public.review_accounts set kept_reason = v_reason where user_id = r.user_id;
      if public.review_account_raise_alert(r.user_id, r.purpose, r.expires_at, r.last_alert_at, v_reason) then
        n_alerts := n_alerts + 1;
      end if;
    end;
  end loop;
  return jsonb_build_object('deleted', n_deleted, 'kept', n_kept, 'errors', n_errors, 'alerts', n_alerts);
end;
$$;

-- Schedules the nightly job (02:40 UTC, after the 02:20 and 02:25 wallet jobs). Without pg_cron it FAILS (the migration is then not
-- applied) instead of quietly scheduling nothing. The argument exists only so a test can prove the failure path.
create or replace function public.review_accounts_schedule_job(p_extension text default 'pg_cron')
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_extension where extname = p_extension) then
    raise exception 'pg_cron is not installed, so the review accounts cannot be deleted automatically';
  end if;
  perform cron.unschedule('delete-expired-review-accounts') where exists (select 1 from cron.job where jobname = 'delete-expired-review-accounts');
  perform cron.schedule('delete-expired-review-accounts', '40 2 * * *', 'select public.delete_expired_review_accounts();');
end;
$$;

-- Nobody through the API: the nightly job runs as the owner.
revoke all on function public.review_accounts_audit(text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.review_account_keep_reason(uuid) from public, anon, authenticated, service_role;
revoke all on function public.review_account_raise_alert(uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_expired_review_accounts() from public, anon, authenticated, service_role;
revoke all on function public.review_accounts_schedule_job(text) from public, anon, authenticated, service_role;

do $$
begin
  perform public.review_accounts_schedule_job();
end $$;
