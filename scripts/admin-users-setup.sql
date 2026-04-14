-- Admin users table setup for the in-app Admin Login modal
-- Run in Supabase SQL Editor

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  username text not null unique,
  password text not null
);

alter table public.admin_users enable row level security;

-- Allow reading admin credential rows for this app flow (client-side check).
-- For production, replace this with a secure server-side auth approach.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_users'
      and policyname = 'Public can read admin users'
  ) then
    create policy "Public can read admin users"
      on public.admin_users
      for select
      using (true);
  end if;
end $$;
