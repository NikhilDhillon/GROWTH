-- Test-only Supabase auth/role stand-ins. Never apply this to a real database.
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select current_setting('request.jwt.claim.role', true);
$$;
-- Supabase grants table access and uses RLS to limit rows. Mirror that boundary,
-- rather than accidentally passing tests because all table privileges are absent.
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
