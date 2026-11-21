-- 18 Nov 2026 (PM, second PM chat, written line of about 13:00: SHOULD item 11, RELEASED behind a switch that is OFF): email for "top-up approved" (to the payer) and for
-- "tutor has not joined" (to the learner or parent). The email carries the EXACT title and body of the in-app notice, one line and a link; nothing else (the Worker builds it, server/noticeEmails.ts).
-- Purely ADDITIVE: three settings (all OFF or a number), two small tables nobody can read, two functions the SERVER KEY alone can call. Nothing that exists is changed: no existing function body, no policy,
-- no grant widened, no money or wallet function, no trigger. It does NOTHING until the Worker calls notice_email_claim AND a setting is switched on by the CEO.
--
-- How it works: the Worker (every few minutes) calls notice_email_claim(). It looks at the in-app notices written in the last 3 hours (a mail later than that would be stale) of the two kinds whose switch is ON:
--   topup_approved   = notification type 'wallet_topup_added' ("Money added to your wallet": the notice the database writes when a bank top-up is credited);
--   tutor_not_joined = notification type 'tutor_not_joined'. NOTE: NO notice of that type is written anywhere in the database yet (checked 18 Nov 2026: no migration inserts one). This function does not invent one:
--   until a notice of that type exists, that kind simply finds nothing to send.
-- A notice is claimed ONCE (notice_emails.notification_id is the primary key), so a repeated call, an overlapping call or a crash can never send the same notice twice (a claim that was never finished is not retried: at most
-- once, and it counts against the day). A daily cap (setting notice_email_daily_cap, 80; never above 95 whatever is typed: Resend's free plan is 100 a day and the sign-up and closing mails share it) is counted in
-- South African days; at the cap nothing is claimed, the in-app notice stays the only message, and the day's count of "held back at the cap" goes up. notice_email_finish() records sent or failed.
-- What is stored: the notice id, the kind, the day, the status and counts. NEVER an address, a name or the text: the Worker reads the address from Auth at send time and keeps nothing.
-- Rollback: Drake/programmer/rollbacks/20261118220000_notice_emails_ROLLBACK.sql

-- 1. settings (all OFF by default; the CEO switches a kind on in the admin app's settings) --------------------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values
  ('notice_email_topup_approved', 'false'::jsonb, 'Email the payer when a bank top-up is credited (the same words as the in-app notice "Money added to your wallet", plus a link). OFF until the CEO switches it on. Needs the Worker mail path (RESEND_API_KEY and MAIL_FROM) as well.'),
  ('notice_email_tutor_not_joined', 'false'::jsonb, 'Email the learner or parent when the in-app notice that a tutor has not joined is written (the same words, plus a link). OFF until the CEO switches it on. No such in-app notice exists yet, so this sends nothing until one does.'),
  ('notice_email_daily_cap', '80'::jsonb, 'The most notice emails sent in one South African day (Resend''s free plan allows 100 a day and the sign-up and closing mails share it). At the cap nothing is sent and the in-app notice stays. Never above 95.')
on conflict (setting_key) do nothing;

-- 2. who was claimed (service key only: row level security on, no policy) ------------------------------------------------------------------------------------------------------
create table if not exists public.notice_emails (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  kind text not null check (kind in ('topup_approved', 'tutor_not_joined')),
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  day date not null default ((now() at time zone 'Africa/Johannesburg')::date),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists notice_emails_day_idx on public.notice_emails (day, status);
alter table public.notice_emails enable row level security;
revoke all on public.notice_emails from public, anon, authenticated;

-- the day's counts, kept for the admin to read later (counts only)
create table if not exists public.notice_email_days (
  day date primary key,
  sent integer not null default 0,
  failed integer not null default 0,
  held_at_cap integer not null default 0
);
alter table public.notice_email_days enable row level security;
revoke all on public.notice_email_days from public, anon, authenticated;

-- 3. claim: the notices to mail now (service key only) ----------------------------------------------------------------------------------------------------------------------------
create or replace function public.notice_email_claim(p_limit integer default 10)
returns table (notification_id uuid, profile_id uuid, kind text, title text, body text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_day date := (now() at time zone 'Africa/Johannesburg')::date;
  v_topup boolean := coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'notice_email_topup_approved'), false);
  v_notjoined boolean := coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'notice_email_tutor_not_joined'), false);
  v_cap integer;
  v_used integer;
  v_room integer;
  v_waiting integer;
begin
  if not (v_topup or v_notjoined) then
    return;
  end if;
  -- one claim at a time, so two overlapping calls cannot both think there is room under the cap
  perform pg_advisory_xact_lock(hashtext('notice_email_claim'));

  begin
    v_cap := least(greatest(coalesce((select (s.setting_value #>> '{}')::integer from public.system_settings s where s.setting_key = 'notice_email_daily_cap'), 80), 0), 95);
  exception when others then
    v_cap := 80;
  end;
  select count(*)::integer into v_used from public.notice_emails e where e.day = v_day and e.status in ('claimed', 'sent');
  v_room := v_cap - v_used;

  select count(*)::integer into v_waiting
  from public.notifications n
  where n.created_at > now() - interval '3 hours'
    and ((n.type = 'wallet_topup_added' and v_topup) or (n.type = 'tutor_not_joined' and v_notjoined))
    and not exists (select 1 from public.notice_emails e where e.notification_id = n.id);
  if v_waiting = 0 then
    return;
  end if;
  if v_room <= 0 then
    insert into public.notice_email_days (day, held_at_cap) values (v_day, v_waiting)
    on conflict (day) do update set held_at_cap = public.notice_email_days.held_at_cap + excluded.held_at_cap;
    return;
  end if;

  return query
    with picked as (
      select n.id as nid, n.profile_id as pid,
             case n.type when 'wallet_topup_added' then 'topup_approved' else 'tutor_not_joined' end as pkind,
             n.title as ptitle, n.body as pbody
      from public.notifications n
      where n.created_at > now() - interval '3 hours'
        and ((n.type = 'wallet_topup_added' and v_topup) or (n.type = 'tutor_not_joined' and v_notjoined))
        and not exists (select 1 from public.notice_emails e where e.notification_id = n.id)
      order by n.created_at, n.id
      limit least(greatest(coalesce(p_limit, 10), 1), 50, v_room)
    ), claimed as (
      insert into public.notice_emails (notification_id, kind, day)
      select p.nid, p.pkind, v_day from picked p
      on conflict on constraint notice_emails_pkey do nothing
      returning public.notice_emails.notification_id as cid
    )
    select p.nid, p.pid, p.pkind, p.ptitle, p.pbody from picked p join claimed c on c.cid = p.nid;
end;
$$;
revoke all on function public.notice_email_claim(integer) from public, anon, authenticated;
grant execute on function public.notice_email_claim(integer) to service_role;

-- 4. finish: record what happened (service key only) ----------------------------------------------------------------------------------------------------------------------------------
create or replace function public.notice_email_finish(p_notification_id uuid, p_sent boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_day date;
begin
  update public.notice_emails e
  set status = case when p_sent then 'sent' else 'failed' end, finished_at = now()
  where e.notification_id = p_notification_id and e.status = 'claimed'
  returning e.day into v_day;
  if v_day is null then
    return; -- not claimed, or already finished: nothing to count
  end if;
  insert into public.notice_email_days (day, sent, failed) values (v_day, case when p_sent then 1 else 0 end, case when p_sent then 0 else 1 end)
  on conflict (day) do update set sent = public.notice_email_days.sent + excluded.sent, failed = public.notice_email_days.failed + excluded.failed;
end;
$$;
revoke all on function public.notice_email_finish(uuid, boolean) from public, anon, authenticated;
grant execute on function public.notice_email_finish(uuid, boolean) to service_role;
