-- server/index.ts now reads a request's stored price and marks it paid with the service-role key
-- (backlog 7i). service_role bypasses RLS but still needs a base GRANT — the same gotcha recorded
-- for the schools import in src/CONTEXT.md.
grant select, update on public.session_requests to service_role;
