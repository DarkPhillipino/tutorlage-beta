-- CARD CHECKOUT ALLOWLIST (16 Nov 2026, CEO rule): the Paystack TEST card is not for normal users. Until live keys exist, only a short list of people may start a card
-- payment; everyone else pays from the wallet (bank transfer, the CEO confirms the top-up in the admin app).
-- Brief: Drake/programmer/pm-instructions.md, 16 Nov 2026 (PM), later, job B. This file changes the database only; the Worker (server/cardCheckout.ts) and the booking page
-- (src/lib/cardCheckout.ts) are the two readers.
--
-- WHAT IS NEW (nothing that exists is replaced or dropped)
--   * setting  card_checkout_mode  off | staff | on   (seeded 'staff'). off = nobody, staff = the allowlist below, on = everyone. Not a wallet_ key, so only a SUPER ADMIN can change it
--                                  (system_settings_role_guard). A missing row, or any other word, reads as 'staff' (never as 'on').
--   * table    card_checkout_staff  profile_id, note. Closed to every browser (RLS on, no grants). Seeded with the CEO's production admin sign-in (sechaba@tutorlage.god) only.
--   * "the allowlist" = the people in card_checkout_staff PLUS the live review accounts (public.review_accounts: Demo Parent, Demo Learner, Demo Tutor, until each row expires,
--     29 Nov 2026; the nightly job deletes them after that, so they drop off by themselves).
--   * card_checkout_allowed(profile)  service_role only: the Worker asks it before it starts a card payment or charges a saved card.
--   * card_checkout_available()       signed-in browsers: asks about THEMSELVES only (auth.uid()); the booking page uses it to decide whether the card is shown at all.
-- Any doubt (no row, an odd word, no person) answers FALSE. Whole file is one transaction and can be run inside the rolled-back runner.

insert into public.system_settings (setting_key, setting_value, description) values
  ('card_checkout_mode', '"staff"'::jsonb,
   'Who may start a card (Paystack) payment: off (nobody), staff (only the people in card_checkout_staff and the live review accounts), on (everyone). Everyone else pays from the wallet. A missing or odd value counts as staff.')
on conflict (setting_key) do nothing;

create table if not exists public.card_checkout_staff (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  note text check (length(note) <= 200),
  added_at timestamptz not null default now()
);
alter table public.card_checkout_staff enable row level security;
revoke all on public.card_checkout_staff from public, anon, authenticated, service_role;

-- the CEO's own sign-in (an email lookup, so the file runs unchanged anywhere; no row where the account does not exist)
insert into public.card_checkout_staff (profile_id, note)
select p.id, 'CEO production admin sign-in (seeded 16 Nov 2026)'
from public.profiles p
where lower(p.email) = 'sechaba@tutorlage.god'
on conflict (profile_id) do nothing;

create or replace function public.card_checkout_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(btrim(coalesce((select s.setting_value #>> '{}' from public.system_settings s where s.setting_key = 'card_checkout_mode'), '')))
           when 'on' then 'on' when 'off' then 'off' else 'staff' end;
$$;
revoke all on function public.card_checkout_mode() from public, anon, authenticated, service_role;

create or replace function public.card_checkout_allowed(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile is not null and case public.card_checkout_mode()
           when 'on' then true
           when 'staff' then
             exists (select 1 from public.card_checkout_staff st where st.profile_id = p_profile)
             or exists (select 1 from public.review_accounts r
                        where r.user_id = p_profile and r.deleted_at is null and r.expires_at > now())
           else false end;
$$;
revoke all on function public.card_checkout_allowed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.card_checkout_allowed(uuid) to service_role;

create or replace function public.card_checkout_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.card_checkout_allowed(auth.uid());
$$;
revoke all on function public.card_checkout_available() from public, anon, authenticated, service_role;
grant execute on function public.card_checkout_available() to authenticated;
