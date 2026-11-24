-- JOB COUNTERS (PM line 62, 24 Nov 2026): per-tutor counts WITH NO PERSONAL DATA.
--   NEW table    public.tutor_daily_counts (tutor_id, day, kind, n): one row per tutor per South African day per kind ('page_open', 'book_tap'). No visitor id, no IP, no device,
--                no cookie, no time of day, no user agent: a number goes up by one. The table is closed to the app (no select, no write).
--   NEW function public.count_tutor_page_event(p_code text, p_kind text): the only way in; open to a visitor who is not signed in; counts only for a tutor whose public page is ON
--                (the same test as the page itself); an unknown, off or odd code, or kind, does nothing and says nothing. At most 20000 a day per tutor and kind (a runaway cannot fill the table).
--   NEW function public.tutor_family_counts(p_tutor uuid, p_from date, p_to date)  (internal, no one can call it): families that signed up with her code, first credit added, first request,
--                first lesson completed, as numbers, by day. Reads existing tables; stores nothing.
--   NEW function public.admin_tutor_counts(p_from date, p_to date)  finance admins only: per tutor, per day and in total, the six numbers.
--   NEW function public.my_tutor_counts()  signed in: her OWN totals, the six numbers, nothing else.
-- UNDO: drop function public.my_tutor_counts(); drop function public.admin_tutor_counts(date, date); drop function public.tutor_family_counts(uuid, date, date);
--       drop function public.count_tutor_page_event(text, text); drop table public.tutor_daily_counts;

create table if not exists public.tutor_daily_counts (
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('page_open', 'book_tap')),
  n integer not null default 0 check (n >= 0),
  primary key (tutor_id, day, kind)
);
alter table public.tutor_daily_counts enable row level security;
revoke all on table public.tutor_daily_counts from public, anon, authenticated, service_role;

create or replace function public.count_tutor_page_event(p_code text, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
  v_day date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if p_kind is null or p_kind not in ('page_open', 'book_tap') then return; end if;
  select pc.owner_tutor_id into v_tutor
    from public.promo_codes pc
   where pc.code = public.promo_normalise(p_code) and pc.owner_tutor_id is not null and pc.active
   limit 1;
  if v_tutor is null then return; end if;
  if not exists (select 1 from public.tutor_public_profile x where x.tutor_id = v_tutor and x.is_public) then return; end if;
  insert into public.tutor_daily_counts as c (tutor_id, day, kind, n) values (v_tutor, v_day, p_kind, 1)
  on conflict (tutor_id, day, kind) do update set n = c.n + 1 where c.n < 20000;
end;
$$;
revoke all on function public.count_tutor_page_event(text, text) from public;
grant execute on function public.count_tutor_page_event(text, text) to anon, authenticated;

-- numbers by day for one tutor (South African days): sign-ups with her code, first credit, first request, first completed lesson
create or replace function public.tutor_family_counts(p_tutor uuid, p_from date, p_to date)
returns table (day date, kind text, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  with fam as (
    select p.id, p.promo_attached_at
      from public.profiles p join public.promo_codes pc on pc.id = p.promo_code_id
     where pc.owner_tutor_id = p_tutor
  ), ev(ts, kind) as (
    select f.promo_attached_at, 'signup' from fam f where f.promo_attached_at is not null
    union all
    select (select min(coalesce(t.decided_at, t.created_at)) from public.wallet_topups t where t.profile_id = f.id and t.status = 'successful'), 'first_credit' from fam f
    union all
    select (select min(r.created_at) from public.session_requests r where r.requested_by_profile_id = f.id), 'first_request' from fam f
    union all
    select (select min(coalesce(s.completed_at, s.scheduled_start)) from public.sessions s where s.booked_by_profile_id = f.id and s.status = 'completed'), 'first_lesson' from fam f
  )
  select (e.ts at time zone 'Africa/Johannesburg')::date as day, e.kind, count(*)::bigint
    from ev e
   where e.ts is not null and (e.ts at time zone 'Africa/Johannesburg')::date between p_from and p_to
   group by 1, 2;
$$;
revoke all on function public.tutor_family_counts(uuid, date, date) from public, anon, authenticated, service_role;

create or replace function public.admin_tutor_counts(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_to date;
  v_from date;
  v_out jsonb;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  v_to := coalesce(p_to, (now() at time zone 'Africa/Johannesburg')::date);
  v_from := coalesce(p_from, v_to - 29);
  if v_from > v_to or v_to - v_from > 365 then
    raise exception 'Pick a range of one year or less.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'tutor_id', t.id, 'first_name', coalesce(nullif(split_part(btrim(coalesce(pr.full_name, '')), ' ', 1), ''), 'Tutor'),
           'code', pc.code,
           'totals', (select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) from (
                        select c.kind, sum(c.n)::bigint as n from public.tutor_daily_counts c where c.tutor_id = t.id and c.day between v_from and v_to group by c.kind
                        union all
                        select f.kind, sum(f.n)::bigint from public.tutor_family_counts(t.id, v_from, v_to) f group by f.kind) k),
           'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'kind', d.kind, 'n', d.n) order by d.day, d.kind), '[]'::jsonb) from (
                        select c.day, c.kind, c.n::bigint as n from public.tutor_daily_counts c where c.tutor_id = t.id and c.day between v_from and v_to
                        union all
                        select f.day, f.kind, f.n from public.tutor_family_counts(t.id, v_from, v_to) f) d)
         ) order by pr.full_name), '[]'::jsonb)
    into v_out
    from public.tutor_profiles t
    join public.profiles pr on pr.id = t.id
    join public.promo_codes pc on pc.owner_tutor_id = t.id and pc.active
   where t.is_verified;
  return jsonb_build_object('from', v_from, 'to', v_to, 'tutors', v_out);
end;
$$;
revoke all on function public.admin_tutor_counts(date, date) from public, anon;
grant execute on function public.admin_tutor_counts(date, date) to authenticated;

create or replace function public.my_tutor_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then return null; end if;
  return (select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) from (
            select c.kind, sum(c.n)::bigint as n from public.tutor_daily_counts c where c.tutor_id = auth.uid() group by c.kind
            union all
            select f.kind, sum(f.n)::bigint from public.tutor_family_counts(auth.uid(), date '2020-01-01', date '2100-01-01') f group by f.kind) k);
end;
$$;
revoke all on function public.my_tutor_counts() from public, anon;
grant execute on function public.my_tutor_counts() to authenticated;
