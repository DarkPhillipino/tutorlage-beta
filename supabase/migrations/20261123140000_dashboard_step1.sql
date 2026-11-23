-- 2026-11-23, dashboard step 1: THE DATABASE ONLY (PM line 42 job C and line 43; sizing in Drake/programmer/reports/2026-11-23-dashboard-sizing.md). ADDITIVE: two config tables (no API right on
-- them), nine new functions, two new settings. Nothing existing is changed. No screen reads any of this yet.
-- Slice 1 is DEFAULTS ONLY (PM decision 5): no personal layouts, no save/reset functions.
--   dashboard_widgets   what widgets exist: key, board ('admin' or 'tutor'), title, who may use it (admin roles, or 'tutor'), the database function that feeds it (null = the screen's own existing component).
--   dashboard_defaults  per board and role, the ordered list of widget keys.
--   my_dashboard(board)             the caller's widget list (default for their role, only widgets they may use).
--   dashboard_data(board, keys[])   STABLE: runs each allowed widget's function inside its own exception block and returns {key: {ok, data} | {ok:false, error}} in ONE round trip.
-- Widget functions (each read only, each checks who is asking, each returns numbers and words, no personal data beyond what that admin role already reads):
--   tutor: my_level_progress(), my_verification_checklist()         (self only: they use auth.uid(), they accept no tutor id)
--   admin: admin_dashboard_numbers(), admin_verification_board(), admin_verified_battery()
-- Level battery rules (PM decision 6): hours, rating and written reviews are numbers with their thresholds; repeat rate and grade uplift are only "met / not met" (no score, so nobody games a
-- visible score); "your level comes from a credential" and "frozen" are flags; a next step into tier 4 is not shown until the public ladder shows tier 4 (a verified tutor is IN tier 4), as the ladder does.
-- Settings: verified_tutor_target (10; the first-10 rule). Needs migration 20261123120000 (the drift table) for one count on the board; without it that count is 0.
-- Rollback: Drake/programmer/rollbacks/20261123140000_dashboard_step1_ROLLBACK.sql. Test: supabase/tests/p4_dashboard_db.sql.

insert into public.system_settings (setting_key, setting_value, description) values
  ('verified_tutor_target', '10'::jsonb, 'The dashboard battery "verified tutors": how many verified tutors the first-launch rule asks for. Whole number, 1 or more (a bad value counts as 10).')
on conflict (setting_key) do nothing;

create table if not exists public.dashboard_widgets (
  key text primary key,
  board text not null check (board in ('admin', 'tutor')),
  title text not null,
  roles text[] not null,
  fn text,
  sort_order integer not null default 0
);
create table if not exists public.dashboard_defaults (
  board text not null check (board in ('admin', 'tutor')),
  role_key text not null,
  widgets jsonb not null default '[]'::jsonb,
  primary key (board, role_key)
);
alter table public.dashboard_widgets enable row level security;
alter table public.dashboard_defaults enable row level security;
revoke all on table public.dashboard_widgets from public, anon, authenticated, service_role;
revoke all on table public.dashboard_defaults from public, anon, authenticated, service_role;

insert into public.dashboard_widgets (key, board, title, roles, fn, sort_order) values
  ('numbers', 'admin', 'Numbers', array['super_admin', 'verification_officer', 'finance_manager', 'support_agent'], 'admin_dashboard_numbers', 10),
  ('verification_board', 'admin', 'Verification', array['super_admin', 'verification_officer'], 'admin_verification_board', 20),
  ('verified_battery', 'admin', 'Verified tutors', array['super_admin', 'verification_officer'], 'admin_verified_battery', 30),
  ('level_battery', 'tutor', 'Your level', array['tutor'], 'my_level_progress', 10),
  ('verification_checklist', 'tutor', 'Your verification', array['tutor'], 'my_verification_checklist', 20),
  ('upcoming_sessions', 'tutor', 'Upcoming sessions', array['tutor'], null, 30)
on conflict (key) do nothing;
insert into public.dashboard_defaults (board, role_key, widgets) values
  ('admin', 'verification_officer', '["verification_board", "verified_battery", "numbers"]'::jsonb),
  ('admin', 'super_admin', '["numbers", "verification_board", "verified_battery"]'::jsonb),
  ('admin', 'finance_manager', '["numbers"]'::jsonb),
  ('admin', 'support_agent', '["numbers"]'::jsonb),
  ('tutor', 'tutor', '["level_battery", "verification_checklist", "upcoming_sessions"]'::jsonb)
on conflict (board, role_key) do nothing;

-- Who is asking, for a board: the admin role for 'admin', 'tutor' for 'tutor'; anyone else is refused.
create or replace function public.dashboard_role(p_board text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  if p_board = 'admin' then
    select a.admin_role::text into v from public.admin_profiles a where a.id = auth.uid() and a.is_active;
  elsif p_board = 'tutor' then
    select 'tutor' into v from public.tutor_profiles t where t.id = auth.uid();
  else
    raise exception 'No such dashboard';
  end if;
  if v is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function public.dashboard_role(text) from public, anon, authenticated, service_role;

create or replace function public.my_dashboard(p_board text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.dashboard_role(p_board);
begin
  return jsonb_build_object('board', p_board, 'role', v_role, 'widgets', coalesce((
    select jsonb_agg(jsonb_build_object('key', w.key, 'title', w.title, 'client_only', w.fn is null) order by k.ord)
      from public.dashboard_defaults d
      cross join lateral jsonb_array_elements_text(d.widgets) with ordinality as k(key, ord)
      join public.dashboard_widgets w on w.key = k.key and w.board = p_board and v_role = any (w.roles)
     where d.board = p_board and d.role_key = v_role), '[]'::jsonb));
end;
$$;

create or replace function public.dashboard_data(p_board text, p_widgets text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.dashboard_role(p_board);
  w record;
  v jsonb;
  out jsonb := '{}'::jsonb;
begin
  for w in
    select x.key, x.fn from public.dashboard_widgets x
     where x.board = p_board and v_role = any (x.roles) and (p_widgets is null or x.key = any (p_widgets))
     order by x.sort_order
  loop
    if w.fn is null then
      out := out || jsonb_build_object(w.key, jsonb_build_object('ok', true, 'client_only', true));
    else
      begin
        execute format('select public.%I()', w.fn) into v;
        out := out || jsonb_build_object(w.key, jsonb_build_object('ok', true, 'data', v));
      exception when others then
        out := out || jsonb_build_object(w.key, jsonb_build_object('ok', false, 'error', sqlerrm));
      end;
    end if;
  end loop;
  return out;
end;
$$;

-- ---- tutor: the level battery -----------------------------------------------------------------------------------------------------------------
create or replace function public.my_level_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record; cur record; nxt record;
  v_hours numeric; v_prior numeric; v_floor_rate numeric; v_tier4_open boolean;
begin
  perform public.dashboard_role('tutor');
  select * into t from public.tutor_profiles where id = auth.uid();
  select * into cur from public.sub_tier_definitions where id = t.current_sub_tier_id;
  select coalesce(sum(hours), 0) into v_prior from public.tutor_prior_hours where tutor_id = t.id and removed_at is null;
  v_hours := coalesce(t.total_completed_hours, 0) + v_prior;
  -- tier 4 is shown as a next step only once the public ladder shows it (a verified tutor is in it), or when the tutor is already in it
  select exists (select 1 from public.tutor_profiles x where x.current_tier_id = 4 and x.is_verified) into v_tier4_open;
  select * into nxt from public.sub_tier_definitions s
   where s.max_allowed_rate > coalesce(cur.max_allowed_rate, 0) and (s.tier_id <> 4 or t.current_tier_id = 4 or v_tier4_open)
   order by s.max_allowed_rate limit 1;
  select max_allowed_rate into v_floor_rate from public.sub_tier_definitions where id = t.credential_floor_sub_tier_id;
  return jsonb_build_object(
    'current', jsonb_build_object('id', t.current_sub_tier_id, 'rate', cur.max_allowed_rate),
    'frozen', coalesce(t.tier_frozen, false),
    'frozen_reason', case when coalesce(t.tier_frozen, false) then t.freeze_reason else null end,
    'from_credential', t.credential_floor_sub_tier_id is not null and t.current_sub_tier_id = t.credential_floor_sub_tier_id,
    'top', nxt.id is null,
    'next', case when nxt.id is null then null else jsonb_build_object('id', nxt.id, 'rate', nxt.max_allowed_rate, 'crosses_tier', nxt.tier_id <> t.current_tier_id) end,
    'hours', case when nxt.id is null then null else jsonb_build_object('have', round(v_hours, 2), 'need', nxt.min_hours, 'met', v_hours >= nxt.min_hours) end,
    'rating', case when nxt.id is null then null else jsonb_build_object('have', round(coalesce(t.avg_rating, 0), 2), 'need', nxt.min_rating, 'met', coalesce(t.avg_rating, 0) >= nxt.min_rating) end,
    'reviews', case when nxt.id is null then null else jsonb_build_object('have', coalesce(t.total_reviews_count, 0), 'need', nxt.min_written_reviews, 'met', coalesce(t.total_reviews_count, 0) >= nxt.min_written_reviews) end,
    -- described, never scored: only whether it is met (and left out when the next level does not ask for it)
    'repeat_rate_met', case when nxt.id is null or nxt.min_repeat_rate_pct = 0 then null else coalesce(t.repeat_student_rate_pct, 0) >= nxt.min_repeat_rate_pct end,
    'uplift_met', case when nxt.id is null or (nxt.min_distinct_students_uplift = 0 and nxt.required_grade_uplift_pct = 0) then null
                       else coalesce(t.qualified_uplift_students_count, 0) >= nxt.min_distinct_students_uplift and coalesce(t.avg_grade_uplift_pct, 0) >= nxt.required_grade_uplift_pct end);
end;
$$;

-- ---- tutor: the verification checklist ------------------------------------------------------------------------------------------------------------
create or replace function public.my_verification_checklist()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ready jsonb;
  v_police record;
  v_verified boolean;
begin
  perform public.dashboard_role('tutor');
  v_ready := public.tutor_readiness(auth.uid());
  select coalesce(is_verified, false) into v_verified from public.tutor_profiles where id = auth.uid();
  select d.issued_on, d.status::text as status into v_police from public.tutor_verification_documents d
   where d.tutor_id = auth.uid() and d.document_type::text = 'police_clearance' and d.status::text <> 'rejected'
   order by d.issued_on desc nulls last limit 1;
  return jsonb_build_object('verified', v_verified, 'ready', v_ready -> 'ready', 'reasons', v_ready -> 'reasons', 'track', v_ready -> 'track',
    'police', case when v_police.status is null then null else jsonb_build_object('status', v_police.status, 'issued_on', v_police.issued_on,
      'counts_until', (v_police.issued_on + interval '6 months')::date) end);
end;
$$;

-- ---- admin: the verified-tutors battery -----------------------------------------------------------------------------------------------------------
create or replace function public.admin_verified_battery()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_target integer; v_n integer;
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then raise exception 'Only a verification officer or a super admin can see this' using errcode = '42501'; end if;
  select case when (setting_value #>> '{}') ~ '^[0-9]+$' and (setting_value #>> '{}')::integer >= 1 then (setting_value #>> '{}')::integer else 10 end into v_target
    from public.system_settings where setting_key = 'verified_tutor_target';
  v_target := coalesce(v_target, 10);
  select count(*) into v_n from public.tutor_profiles where is_verified;
  return jsonb_build_object('verified', v_n, 'target', v_target, 'percent', least(100, round(v_n * 100.0 / v_target)));
end;
$$;

-- ---- admin: the verification board (read only grouped columns; a card opens the tutor's page) ----------------------------------------------------------
create or replace function public.admin_verification_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record; v_ready jsonb; v_col text;
  cards jsonb := '{}'::jsonb; counts jsonb := '{"nothing_yet":0,"waiting":0,"under_review":0,"incomplete":0,"ready":0,"approved":0,"refused":0}'::jsonb;
  v_drift integer := 0;
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not public.admin_role_in(array['verification_officer', 'super_admin']) then raise exception 'Only a verification officer or a super admin can see this' using errcode = '42501'; end if;
  for t in
    select tp.id, tp.is_verified, tp.onboarding_status::text as st, p.full_name, tp.created_at,
           (select count(*) from public.tutor_verification_documents d where d.tutor_id = tp.id) as docs,
           (select count(*) from public.tutor_verification_documents d where d.tutor_id = tp.id and d.status::text = 'pending') as pending,
           (select count(*) from public.tutor_verification_documents d where d.tutor_id = tp.id and d.status::text = 'under_review') as under_review,
           (select min(d.uploaded_at) from public.tutor_verification_documents d where d.tutor_id = tp.id and d.status::text in ('pending', 'under_review')) as since
      from public.tutor_profiles tp join public.profiles p on p.id = tp.id
     order by coalesce((select min(d.uploaded_at) from public.tutor_verification_documents d where d.tutor_id = tp.id and d.status::text in ('pending', 'under_review')), tp.created_at)
     limit 300
  loop
    if t.is_verified then v_col := 'approved';
    elsif t.st = 'rejected' then v_col := 'refused';
    else
      v_ready := public.tutor_readiness(t.id);
      v_col := case when (v_ready ->> 'ready')::boolean then 'ready' when t.under_review > 0 then 'under_review' when t.pending > 0 then 'waiting'
                    when t.docs = 0 then 'nothing_yet' else 'incomplete' end;
    end if;
    counts := jsonb_set(counts, array[v_col], to_jsonb((counts ->> v_col)::integer + 1));
    -- approved and refused are counts only; the other columns show up to 8 cards, longest waiting first, each with the reasons it is not ready
    if v_col not in ('approved', 'refused') and coalesce(jsonb_array_length(cards -> v_col), 0) < 8 then
      cards := jsonb_set(cards, array[v_col], coalesce(cards -> v_col, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'tutor_id', t.id, 'name', coalesce(nullif(btrim(t.full_name), ''), 'Tutor'), 'waiting_since', coalesce(t.since, t.created_at), 'reasons', coalesce(v_ready -> 'reasons', '[]'::jsonb))), true);
    end if;
  end loop;
  begin
    select count(distinct tutor_id) into v_drift from public.tutor_drift_findings where resolved_at is null and kind = 'not_ready';
  exception when undefined_table then v_drift := 0;
  end;
  return jsonb_build_object('counts', counts, 'cards', cards, 'approved_not_ready_now', v_drift);
end;
$$;

-- ---- admin: the numbers ---------------------------------------------------------------------------------------------------------------------------
-- Counts only, by role, no personal data. Sections a role may not see are absent from the answer.
create or replace function public.admin_dashboard_numbers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ver boolean; v_money boolean;
  r jsonb := '{}'::jsonb;
  v_week0 date := (date_trunc('week', now() at time zone 'Africa/Johannesburg'))::date - 49;   -- the Monday 7 weeks back: eight weeks with this one
  v_n integer;
begin
  if not public.is_active_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  v_ver := public.admin_role_in(array['verification_officer', 'super_admin']);
  v_money := public.wallet_is_finance_admin();

  r := r || jsonb_build_object(
    'accounts_by_role', jsonb_build_object(
      'tutor', (select count(*) from public.profiles where role::text = 'tutor'),
      'parent', (select count(*) from public.profiles where role::text = 'parent'),
      'learner', (select count(*) from public.profiles where role::text = 'student'),
      'admin', (select count(*) from public.admin_profiles where is_active)),
    'learners_linked_to_parent', (select count(distinct student_id) from public.parent_student_links),
    'signups_per_week', (select jsonb_agg(jsonb_build_object('week_start', w.d,
        'tutors', (select count(*) from public.profiles p where p.role::text = 'tutor' and (p.created_at at time zone 'Africa/Johannesburg')::date >= w.d and (p.created_at at time zone 'Africa/Johannesburg')::date < w.d + 7),
        'parents', (select count(*) from public.profiles p where p.role::text = 'parent' and (p.created_at at time zone 'Africa/Johannesburg')::date >= w.d and (p.created_at at time zone 'Africa/Johannesburg')::date < w.d + 7),
        'learners', (select count(*) from public.profiles p where p.role::text = 'student' and (p.created_at at time zone 'Africa/Johannesburg')::date >= w.d and (p.created_at at time zone 'Africa/Johannesburg')::date < w.d + 7)) order by w.d)
        from (select (v_week0 + 7 * g)::date as d from generate_series(0, 7) g) w),
    'requests_per_week', (select jsonb_agg(jsonb_build_object('week_start', w.d,
        'requests', (select count(*) from public.session_requests q where (q.created_at at time zone 'Africa/Johannesburg')::date >= w.d and (q.created_at at time zone 'Africa/Johannesburg')::date < w.d + 7 and q.status::text <> 'initiated' and q.payment_status::text <> 'initiated')) order by w.d)
        from (select (v_week0 + 7 * g)::date as d from generate_series(0, 7) g) w),
    'sessions_per_week', (select jsonb_agg(jsonb_build_object('week_start', w.d,
        'sessions', (select count(*) from public.sessions s where (s.created_at at time zone 'Africa/Johannesburg')::date >= w.d and (s.created_at at time zone 'Africa/Johannesburg')::date < w.d + 7)) order by w.d)
        from (select (v_week0 + 7 * g)::date as d from generate_series(0, 7) g) w),
    'founding_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.founding_tutors_list group by status) f), '{}'::jsonb),
    'open_requests', (select count(*) from public.session_requests q where q.status::text not in ('accepted', 'cancelled', 'expired', 'initiated') and q.payment_status::text in ('card_verified', 'paid', 'wallet_paid')));

  begin
    select count(*) into v_n from public.admin_stale_requests(24);
    r := r || jsonb_build_object('stale_requests', v_n);
  exception when others then
    null;   -- a role the stale list refuses just does not get the number
  end;

  if v_ver then
    r := r || jsonb_build_object(
      'verified_tutors', (select count(*) from public.tutor_profiles where is_verified),
      'tutors_by_stage', jsonb_build_object(
        'on_the_list', (select count(*) from public.founding_tutors_list where user_id is null and status in ('joined', 'released')),
        'signed_up', (select count(*) from public.tutor_profiles tp where not tp.is_verified and tp.onboarding_status::text <> 'rejected' and not exists (select 1 from public.tutor_verification_documents d where d.tutor_id = tp.id)),
        'documents_in', (select count(*) from public.tutor_profiles tp where not tp.is_verified and tp.onboarding_status::text <> 'rejected'
                           and exists (select 1 from public.tutor_verification_documents d where d.tutor_id = tp.id)
                           and not exists (select 1 from public.tutor_verification_documents d where d.tutor_id = tp.id and d.status::text = 'under_review')),
        'under_review', (select count(*) from public.tutor_profiles tp where not tp.is_verified and tp.onboarding_status::text <> 'rejected'
                           and exists (select 1 from public.tutor_verification_documents d where d.tutor_id = tp.id and d.status::text = 'under_review')),
        'verified', (select count(*) from public.tutor_profiles where is_verified),
        'refused', (select count(*) from public.tutor_profiles where onboarding_status::text = 'rejected' and not is_verified)));
  end if;
  if v_money then
    r := r || jsonb_build_object(
      'topups_to_confirm', (select count(*) from public.wallet_topups where method = 'eft' and status = 'awaiting_proof'),
      'payouts_due', (select count(*) from public.payout_requests where status = 'requested'));
    begin
      select count(*) into v_n from public.admin_rejected_payment_alert();
      r := r || jsonb_build_object('refused_payment_alerts', v_n);
    exception when others then
      null;
    end;
  end if;
  return r;
end;
$$;

-- ---- who may call what ----------------------------------------------------------------------------------------------------------------------------
revoke all on function public.my_dashboard(text) from public, anon, service_role;
revoke all on function public.dashboard_data(text, text[]) from public, anon, service_role;
revoke all on function public.my_level_progress() from public, anon, service_role;
revoke all on function public.my_verification_checklist() from public, anon, service_role;
revoke all on function public.admin_verified_battery() from public, anon, service_role;
revoke all on function public.admin_verification_board() from public, anon, service_role;
revoke all on function public.admin_dashboard_numbers() from public, anon, service_role;
grant execute on function public.my_dashboard(text) to authenticated;
grant execute on function public.dashboard_data(text, text[]) to authenticated;
grant execute on function public.my_level_progress() to authenticated;
grant execute on function public.my_verification_checklist() to authenticated;
grant execute on function public.admin_verified_battery() to authenticated;
grant execute on function public.admin_verification_board() to authenticated;
grant execute on function public.admin_dashboard_numbers() to authenticated;
