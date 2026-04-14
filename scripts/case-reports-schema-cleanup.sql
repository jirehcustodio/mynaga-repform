-- Case Reports schema cleanup for mixed/legacy columns
-- Safe to run multiple times.
-- Run in Supabase SQL Editor.

begin;

-- 1) Ensure canonical columns exist
alter table public.case_reports
  add column if not exists "firstName" text,
  add column if not exists "middleName" text,
  add column if not exists "lastName" text,
  add column if not exists "nameSuffix" text,
  add column if not exists email text;

-- 2) Backfill canonical name/email from known legacy variants
update public.case_reports as cr
set
  "firstName" = coalesce(
    nullif(cr."firstName", ''),
    nullif(to_jsonb(cr) ->> 'first_name', ''),
    nullif(to_jsonb(cr) ->> 'firstname', ''),
    'N/A'
  ),
  "middleName" = coalesce(
    nullif(cr."middleName", ''),
    nullif(to_jsonb(cr) ->> 'middle_name', ''),
    nullif(to_jsonb(cr) ->> 'middlename', ''),
    'N/A'
  ),
  "lastName" = coalesce(
    nullif(cr."lastName", ''),
    nullif(to_jsonb(cr) ->> 'last_name', ''),
    nullif(to_jsonb(cr) ->> 'lastname', ''),
    'N/A'
  ),
  "nameSuffix" = coalesce(
    nullif(cr."nameSuffix", ''),
    nullif(to_jsonb(cr) ->> 'name_suffix', ''),
    nullif(to_jsonb(cr) ->> 'namesuffix', '')
  ),
  email = coalesce(
    nullif(cr.email, ''),
    nullif(to_jsonb(cr) ->> 'personalEmail', ''),
    nullif(to_jsonb(cr) ->> 'personal_email', ''),
    nullif(to_jsonb(cr) ->> 'personalemail', ''),
    nullif(to_jsonb(cr) ->> 'workEmail', ''),
    nullif(to_jsonb(cr) ->> 'work_email', ''),
    nullif(to_jsonb(cr) ->> 'workemail', ''),
    'unknown@example.com'
  );

-- 3) Ensure categories has a usable default and no null values
alter table public.case_reports
  alter column categories set default '[]'::jsonb;

update public.case_reports
set categories = '[]'::jsonb
where categories is null;

-- 4) Re-apply required constraints for canonical columns
alter table public.case_reports
  alter column "firstName" set not null,
  alter column "middleName" set not null,
  alter column "lastName" set not null,
  alter column phone set not null,
  alter column email set not null,
  alter column department set not null,
  alter column categories set not null;

commit;

-- Optional: after app and reports are stable, drop legacy duplicate columns.
-- Review first before running.
-- alter table public.case_reports
--   drop column if exists "first_name",
--   drop column if exists firstname,
--   drop column if exists "middle_name",
--   drop column if exists middlename,
--   drop column if exists "last_name",
--   drop column if exists lastname,
--   drop column if exists "name_suffix",
--   drop column if exists namesuffix,
--   drop column if exists "personalEmail",
--   drop column if exists "personal_email",
--   drop column if exists personalemail,
--   drop column if exists "workEmail",
--   drop column if exists "work_email",
--   drop column if exists workemail;
