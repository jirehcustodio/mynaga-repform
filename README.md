# Case Resolution Form (MyNaga Representatives)

A minimalist, multi-page web form inspired by Google Forms. It collects personal information, captures PSO case category resolution times, stores submissions in Supabase, provides an admin view, and supports printable output.

## Features

- Multi-step form with Personal Info and PSO case category pages
- Automatic save to Supabase
- Admin view for reviewing submissions
- Printable report output (browser print-to-PDF)

## Getting Started

1. Install dependencies.
2. Create a `.env` file in the project root with:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Start the dev server.

## Supabase Schema (SQL)

### Recommended canonical schema (single email)

```sql
create table if not exists case_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  "firstName" text not null,
  "middleName" text not null,
  "lastName" text not null,
  "nameSuffix" text,
  phone text not null,
  email text not null,
  department text not null,
  categories jsonb not null default '[]'::jsonb
);
```

### Existing project already has mixed columns?

If your table has legacy variants like `first_name`, `firstname`,
`personalEmail`, `personal_email`, etc., run:

`scripts/case-reports-schema-cleanup.sql`

in Supabase SQL Editor.

This script will:

- ensure canonical columns exist (`firstName`, `middleName`, `lastName`, `nameSuffix`, `email`)
- backfill canonical values from legacy variants
- enforce `NOT NULL` where expected
- keep legacy columns for safety (optional cleanup commands included at the bottom)

Enable Row Level Security (RLS) and policies for testing:

```sql
alter table case_reports enable row level security;

create policy "Public can insert" on case_reports
  for insert
  with check (true);

create policy "Public can read" on case_reports
  for select
  using (true);
```

Adjust policies for production as needed.

## Printing

Use the **Print** button on a submission or after submitting a form, then choose **Save as PDF** in your browser’s print dialog.

## Spreadsheet Analytics

The Analytics tab is generated from the public MyNaga spreadsheet export. To refresh the data:

1. Download the sheet as CSV (place it at `tmp-sheet.csv` in the project root).
2. Run the analysis script to regenerate `src/data/officeTopCategories.ts`.

The script reads **Column I (Office)** and **Column C (Category)** to build the office dropdown and the top categories per office.
