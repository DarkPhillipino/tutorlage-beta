-- Error tracking in our own database (release gate OPS-ERRORS-01; master backlog row 60; the CEO chose "our own table + an admin
-- page" on 20 Oct 2026). Until now a crash was only written to the visitor's own browser console, so nobody at Tutorlage ever
-- heard about it.
--
-- What this adds (additive: nothing is replaced, altered or dropped):
--   1. public.client_errors: one row per KIND of error (same kind + message + screen), with a count, the first and last time it
--      was seen, and how many of the times the person was signed in. Browsers cannot read or write this table at all; only
--      active admins can read it (the admin app's "Errors" page).
--   2. public.log_client_error(...): the ONE narrow way in. Signed-in and signed-out visitors can call it; it cuts every field to a
--      fixed size, scrubs personal data out of the text, counts a repeat instead of adding a row, and refuses to grow the table
--      without limit (at most 60 new kinds of error per hour and 2,000 rows in all; past that it only counts them in one
--      "overflow" row). Whether the person was signed in is read from their sign-in by the database, never taken from the caller.
--   3. public.purge_old_client_errors(): deletes rows not seen for 30 days; a daily job runs it (pg_cron, skipped where absent).
--
-- NO personal data is kept, on purpose: no user id, no email, no phone number, no token, no request body, no address-bar query or
-- fragment. The app strips these before it sends; this file strips them again (emails, sign-in tokens, long token-like strings,
-- ids, phone or ID numbers, the query part of any web address, the code in a /room/ address), so a caller that skips the app's own
-- clean-up still cannot store them.
--
-- The app tolerates this migration being absent (the published site reads the dev database): it just stops trying after the first
-- refusal. Test: supabase/tests/client_errors.sql.

-- ---- 1. the table -------------------------------------------------------------------------------------------------------
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  fingerprint text not null unique,
  kind text not null check (kind in ('render', 'unhandled', 'rejection', 'logged', 'overflow')),
  message text not null check (char_length(message) between 1 and 300),
  screen text not null check (char_length(screen) between 1 and 120),
  details text check (details is null or char_length(details) <= 1500),
  browser text check (browser is null or char_length(browser) <= 80),
  occurrences integer not null default 1 check (occurrences >= 1),
  signed_in_occurrences integer not null default 0 check (signed_in_occurrences >= 0),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists client_errors_last_seen on public.client_errors (last_seen desc);
create index if not exists client_errors_first_seen on public.client_errors (first_seen);

alter table public.client_errors enable row level security;

-- Only an active admin may read (is_active_admin() is callable by signed-in callers only, so the policy is for that role).
drop policy if exists "Admins read client errors" on public.client_errors;
create policy "Admins read client errors" on public.client_errors
  for select to authenticated using (public.is_active_admin());

-- Reads only, for signed-in callers (the policy narrows it to admins). No insert, update or delete for any browser role.
revoke all on public.client_errors from public, anon, authenticated;
grant select on public.client_errors to authenticated;

-- ---- 2. scrubbing helpers (not callable from browsers) ---------------------------------------------------------------------
create or replace function public.scrub_client_error_text(p_text text, p_max integer)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    regexp_replace(                                                             -- phone or ID numbers: 9 or more digits, spaces and dashes
    regexp_replace(                                                             -- long token-like strings (keys, session ids)
    regexp_replace(                                                             -- ids
    regexp_replace(                                                             -- email addresses
    regexp_replace(                                                             -- sign-in tokens (JWTs)
    regexp_replace(                                                             -- the query and fragment of a web address
      left(coalesce(p_text, ''), greatest(p_max, 1) * 4),
      '(https?://[^[:space:]"''<>?#]+)[?#][^[:space:]"''<>]*', '\1', 'g'),
      'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*)?', '[token]', 'g'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '[id]', 'g'),
      '[A-Za-z0-9_-]{32,}', '[token]', 'g'),
      '\+?[0-9][0-9[:space:]().-]{7,}[0-9]', '[number]', 'g'),
    greatest(p_max, 1));
$$;

-- The screen is the address path plus the app's own label for the view. Keep the path, lose anything that could identify a person
-- or open a room: the query and fragment, the code after /room/, ids, and long or number-heavy path pieces.
create or replace function public.scrub_client_error_screen(p_screen text)
returns text
language sql
immutable
set search_path = public
as $$
  select public.scrub_client_error_text(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
      split_part(split_part(left(coalesce(p_screen, ''), 500), '?', 1), '#', 1),
      '/room/[^[:space:]]+', '/room/:code', 'g'),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id', 'g'),
      '/[^/[:space:]]*[0-9]{6}[^/[:space:]]*', '/:id', 'g'),
      '/[^/[:space:]]{25,}', '/:id', 'g'),
    120);
$$;

revoke all on function public.scrub_client_error_text(text, integer) from public, anon, authenticated;
revoke all on function public.scrub_client_error_screen(text) from public, anon, authenticated;

-- ---- 3. the one way in ---------------------------------------------------------------------------------------------------------
create or replace function public.log_client_error(
  p_kind text,
  p_message text,
  p_screen text,
  p_details text default null,
  p_browser text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := case when p_kind in ('render', 'unhandled', 'rejection', 'logged') then p_kind else 'logged' end;
  v_message text := coalesce(nullif(btrim(public.scrub_client_error_text(p_message, 300)), ''), 'Unknown error');
  v_screen text := coalesce(nullif(btrim(public.scrub_client_error_screen(p_screen)), ''), '/');
  v_details text := nullif(btrim(public.scrub_client_error_text(p_details, 1500)), '');
  v_browser text := nullif(btrim(public.scrub_client_error_text(p_browser, 80)), '');
  v_signed_in integer := case when auth.uid() is null then 0 else 1 end;
  v_fingerprint text;
  v_recent integer;
  v_total integer;
begin
  v_fingerprint := md5(v_kind || '|' || v_message || '|' || v_screen);

  -- A repeat of a kind already stored: count it.
  update public.client_errors
     set occurrences = occurrences + 1,
         signed_in_occurrences = signed_in_occurrences + v_signed_in,
         last_seen = now()
   where fingerprint = v_fingerprint;
  if found then
    return;
  end if;

  -- A new kind: only while the table is within its limits (60 new kinds an hour, 2,000 rows in all). Past that, count them
  -- in one overflow row so a flood of made-up errors cannot fill the database.
  select count(*) into v_recent from public.client_errors where kind <> 'overflow' and first_seen > now() - interval '1 hour';
  select count(*) into v_total from public.client_errors;
  if v_recent >= 60 or v_total >= 2000 then
    insert into public.client_errors (fingerprint, kind, message, screen, occurrences, signed_in_occurrences)
    values ('overflow', 'overflow', 'More new kinds of error arrived than can be stored; they are only counted here.', '-', 1, v_signed_in)
    on conflict (fingerprint) do update
      set occurrences = public.client_errors.occurrences + 1,
          signed_in_occurrences = public.client_errors.signed_in_occurrences + v_signed_in,
          last_seen = now();
    return;
  end if;

  insert into public.client_errors (fingerprint, kind, message, screen, details, browser, occurrences, signed_in_occurrences)
  values (v_fingerprint, v_kind, v_message, v_screen, v_details, v_browser, 1, v_signed_in)
  on conflict (fingerprint) do update
    set occurrences = public.client_errors.occurrences + 1,
        signed_in_occurrences = public.client_errors.signed_in_occurrences + v_signed_in,
        last_seen = now();
end;
$$;

revoke all on function public.log_client_error(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;

-- ---- 4. clean-up ------------------------------------------------------------------------------------------------------------------
create or replace function public.purge_old_client_errors()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.client_errors where last_seen < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_old_client_errors() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-old-client-errors') where exists (select 1 from cron.job where jobname = 'purge-old-client-errors');
    perform cron.schedule('purge-old-client-errors', '31 3 * * *', 'select public.purge_old_client_errors();');
  end if;
end $$;
