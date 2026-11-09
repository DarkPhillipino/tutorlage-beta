-- THE SUGGESTIONS BOX (CEO's request of 5 Nov 2026; plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md section 8.5) AND THE TOP-UP PILOT NOTICE
-- (section 8.4). One person writes up to 1,000 characters; an admin reads them, marks them and keeps an internal note.
--
-- WHAT THIS MIGRATION ADDS (it replaces and drops NOTHING that exists):
--   NEW  table    public.platform_suggestions                  one row per suggestion: user, role, body, status, admin_note, created_at, handled_at, handled_by
--   NEW  function public.platform_suggestions_before_insert()  trigger function: fills role from the profile, forces status 'new', trims the text,
--                                                               checks the length and allows 5 suggestions per person in any 24 hours
--   NEW  trigger  platform_suggestions_before_insert           BEFORE INSERT on public.platform_suggestions
--   NEW  function public.admin_handle_suggestion(uuid, text, text)   the ONLY way an admin changes a suggestion: status and internal note, nothing else
--   NEW  function public.my_platform_suggestions()             a person's OWN suggestions: text and date only (never the internal note)
--   NEW  function public.platform_suggestions_on_closure()     trigger function: a closed account's suggestions are deleted with the rest of its data
--   NEW  trigger  platform_suggestions_on_closure              BEFORE INSERT on public.account_deletion_records (the closure's last step; adds a count to the record)
--   NEW  function public.topup_pilot_notice()                  the pilot notice for the Add-money screen, read from one system_settings row
--   NEW  setting  system_settings 'topup_pilot_notice'         text and times of the notice (inserted only if missing; edit it in System Settings, no publish needed)
-- UNCHANGED and still live: everything else. No existing function, policy, trigger or table is touched. closure_delete_data() is NOT replaced: the
-- closure hook is a separate trigger on the deletion record, so this file cannot disturb the close-account work.
--
-- WHO CAN DO WHAT (a call that comes through the API; the owner running SQL and the database's own SECURITY DEFINER functions are not stopped here):
--   * a signed-in person: ADD a suggestion of their own (columns user_id and body only; role, status, note, handled_* are set by the database and a
--     person cannot even name them). They cannot read the table, not even their own rows: the internal note and the admin's name are columns of the
--     same row and row-level security cannot hide a column. They read their own text and date through my_platform_suggestions().
--   * an active admin (public.is_active_admin(), any admin role): READ every row. They have NO insert, update or delete right on the table: the one
--     write is admin_handle_suggestion(), which can change status and internal note only and stamps handled_by / handled_at itself.
--   * signed-out callers and the service key: no access (the Worker never reads this table).
-- Same model as the P2 migrations of 4 Nov (20261104210100: admins read, writes only through narrow functions). Not written to admin_audit_logs on
-- purpose: that column is an enum and adding a value needs its own migration applied first; handled_by and handled_at on the row are the trail.
-- No HTML is ever rendered from this text (the app and the admin app print it as plain text); the database stores it as typed.

-- 1. the table ---------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.platform_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null,
  body text not null,
  status text not null default 'new',
  admin_note text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid,
  constraint platform_suggestions_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint platform_suggestions_handled_by_fkey foreign key (handled_by) references public.admin_profiles (id) on delete set null,
  constraint platform_suggestions_body_length check (char_length(body) between 1 and 1000),
  constraint platform_suggestions_status_values check (status in ('new', 'read', 'planned', 'done', 'dismissed')),
  constraint platform_suggestions_note_length check (admin_note is null or char_length(admin_note) between 1 and 1000)
);
create index if not exists platform_suggestions_created_idx on public.platform_suggestions (created_at desc);
create index if not exists platform_suggestions_status_idx on public.platform_suggestions (status, created_at desc);
create index if not exists platform_suggestions_user_idx on public.platform_suggestions (user_id, created_at desc);

-- 2. rights and row-level security -------------------------------------------------------------------------------------------------------------
alter table public.platform_suggestions enable row level security;
revoke all on public.platform_suggestions from public, anon, authenticated, service_role;
grant select on public.platform_suggestions to authenticated;               -- only an admin's rows come back (policy below)
grant insert (user_id, body) on public.platform_suggestions to authenticated; -- role, status, note and handled_* are not insertable by a person

drop policy if exists "Users add their own suggestion" on public.platform_suggestions;
create policy "Users add their own suggestion" on public.platform_suggestions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Admins read all suggestions" on public.platform_suggestions;
create policy "Admins read all suggestions" on public.platform_suggestions
  for select to authenticated
  using (public.is_active_admin());
-- There is no update or delete policy and no update or delete right: nobody changes or removes a row through the API.

-- 3. before an insert: who wrote it, how long it is, how many that person has sent ----------------------------------------------------------------
create or replace function public.platform_suggestions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_recent integer;
  c_limit constant integer := 5;
begin
  select p.role::text into v_role from public.profiles p where p.id = new.user_id;
  if v_role is null then
    raise exception 'We could not find your account. Please sign in again.' using errcode = '23503';
  end if;

  -- An explicit list of characters: the one-argument btrim trims spaces only, so a text of line breaks was stored and a trailing line break kept
  -- (found by the first production run of the suite, 9 Nov 2026; fixed forward by 20261109054516_platform_suggestions_trim_whitespace.sql).
  new.body := btrim(coalesce(new.body, ''), E' \t\r\n');
  if char_length(new.body) < 1 then
    raise exception 'Please write your suggestion first.' using errcode = '22023';
  end if;
  if char_length(new.body) > 1000 then
    raise exception 'Please keep your suggestion to 1,000 characters or fewer.' using errcode = '22023';
  end if;

  -- At most 5 in any 24 hours per person. The lock makes two sends at the same moment count one after the other.
  perform pg_advisory_xact_lock(hashtextextended('platform_suggestions:' || new.user_id::text, 0));
  select count(*) into v_recent from public.platform_suggestions s
  where s.user_id = new.user_id and s.created_at > now() - interval '24 hours';
  if v_recent >= c_limit then
    raise exception 'You can send up to 5 suggestions a day. Please try again tomorrow.' using errcode = '54000';
  end if;

  -- What the database decides, whatever the caller sent.
  new.role := v_role;
  new.status := 'new';
  new.admin_note := null;
  new.handled_at := null;
  new.handled_by := null;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.platform_suggestions_before_insert() from public, anon, authenticated, service_role;

drop trigger if exists platform_suggestions_before_insert on public.platform_suggestions;
create trigger platform_suggestions_before_insert before insert on public.platform_suggestions
  for each row execute function public.platform_suggestions_before_insert();

-- 4. the admin's one write ----------------------------------------------------------------------------------------------------------------------
-- Sets the status and the internal note (an empty note clears it) and stamps who and when. Going back to 'new' clears the stamp. Returns the row's
-- new state so the screen can show it without reading again.
create or replace function public.admin_handle_suggestion(p_id uuid, p_status text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r public.platform_suggestions;
begin
  if auth.uid() is null or not public.is_active_admin() then
    raise exception 'Only an active admin can handle suggestions' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('new', 'read', 'planned', 'done', 'dismissed') then
    raise exception 'Choose a status: new, read, planned, done or dismissed' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note can be 1,000 characters at most' using errcode = '22023';
  end if;
  update public.platform_suggestions
  set status = p_status,
      admin_note = v_note,
      handled_at = case when p_status = 'new' then null else now() end,
      handled_by = case when p_status = 'new' then null else auth.uid() end
  where id = p_id
  returning * into r;
  if not found then
    raise exception 'No such suggestion' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'admin_note', r.admin_note, 'handled_at', r.handled_at, 'handled_by', r.handled_by);
end;
$$;
revoke all on function public.admin_handle_suggestion(uuid, text, text) from public, anon;
grant execute on function public.admin_handle_suggestion(uuid, text, text) to authenticated;

-- 5. a person's own suggestions, without the internal parts -----------------------------------------------------------------------------------------
create or replace function public.my_platform_suggestions()
returns table (id uuid, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.body, s.created_at
  from public.platform_suggestions s
  where s.user_id = auth.uid()
  order by s.created_at desc
  limit 50;
$$;
revoke all on function public.my_platform_suggestions() from public, anon;
grant execute on function public.my_platform_suggestions() to authenticated;

-- 6. closing an account deletes the person's suggestions --------------------------------------------------------------------------------------------
-- close_account (20261021140000) blanks the profile rows and never deletes them, so a foreign key cannot do this. closure_delete_data() writes
-- the deletion record as its last step and only after the safety-hold check, so a trigger on that insert runs exactly when the person's data
-- really is being deleted, and adds the count to the record ("deleted": {"platform_suggestions": n}).
create or replace function public.platform_suggestions_on_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.platform_suggestions where user_id = new.profile_id;
  get diagnostics n = row_count;
  new.deleted := coalesce(new.deleted, '{}'::jsonb) || jsonb_build_object('platform_suggestions', n);
  return new;
end;
$$;
revoke all on function public.platform_suggestions_on_closure() from public, anon, authenticated, service_role;

drop trigger if exists platform_suggestions_on_closure on public.account_deletion_records;
create trigger platform_suggestions_on_closure before insert on public.account_deletion_records
  for each row execute function public.platform_suggestions_on_closure();

-- 7. the top-up pilot notice (plan 8.4) -------------------------------------------------------------------------------------------------------------
-- The Add-money screen and the wallet page show a notice that says every bank transfer is checked by a person and how long that usually takes.
-- Its words live in ONE system_settings row so the CEO can change the times without a publish. The app does not read system_settings itself (a
-- signed-in person can, through the policy "Public view non-sensitive system settings", but the app should not depend on that); it asks this small
-- function, one stable question with a fixed shape. It returns the row's value (null when there is no row; the app then uses its built-in default
-- words). Signed-in callers only. The row's value is a JSON object, every field optional:
--   {"enabled": true, "times": "6 hours (08:00 to 20:00; a transfer sent later is checked by 10:00 the next morning)",
--    "text": "Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within {times}. We are building instant payments. A tutor is only paid after your session is complete."}
-- {times} in "text" is replaced by "times". "enabled": false hides the notice. Not a wallet_ key on purpose: it is words, not money, and only a super
-- admin can change a non-wallet setting (20261104210000).
create or replace function public.topup_pilot_notice()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select s.setting_value from public.system_settings s where s.setting_key = 'topup_pilot_notice';
$$;
revoke all on function public.topup_pilot_notice() from public, anon;
grant execute on function public.topup_pilot_notice() to authenticated;

-- The starting words (plan 8.4's wording; the times are the CEO's choice of 9 Nov 2026: 6 hours. The file first applied to production on 9 Nov said
-- 3 hours, and the live row was then set to 6; this file now says 6 so a fresh database starts the same). Inserted only when the row does not exist.
insert into public.system_settings (setting_key, setting_value, description) values (
  'topup_pilot_notice',
  jsonb_build_object(
    'enabled', true,
    'times', '6 hours (08:00 to 20:00; a transfer sent later is checked by 10:00 the next morning)',
    'text', 'Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within {times}. We are building instant payments. A tutor is only paid after your session is complete.'
  ),
  'The pilot notice on the Add-money screen and the wallet page. JSON: "times" is the {times} part, "text" is the whole notice ({times} is replaced), "enabled": false hides it. Changing it needs no publish.'
)
on conflict (setting_key) do nothing;
