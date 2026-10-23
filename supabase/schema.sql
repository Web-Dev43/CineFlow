-- CineFlow initial database schema
-- Run in the SQL Editor of a dedicated CineFlow Supabase project.
-- Create the admin user in Supabase Auth first, then add that user's UUID to admin_users.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_name text not null check (char_length(trim(client_name)) between 1 and 100),
  client_email text not null check (char_length(trim(client_email)) between 3 and 254),
  client_phone text,
  service text not null check (service in ('Video shoot','Video editing','Sports highlights','Event coverage','Music video','Photography','Other')),
  requested_date date not null,
  location text,
  budget_range text,
  referral_source text,
  project_details text not null check (char_length(trim(project_details)) between 1 and 3000),
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_created_at_idx on public.bookings (created_at desc);
create index if not exists bookings_requested_date_idx on public.bookings (requested_date);
create index if not exists bookings_status_idx on public.bookings (status);

alter table public.admin_users enable row level security;
alter table public.bookings enable row level security;

-- Explicit grants make the intended Data API access clear. RLS still restricts rows.
grant usage on schema public to anon, authenticated;
grant insert on public.bookings to anon, authenticated;
grant select, update on public.bookings to authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists "Admins can read their own admin record" on public.admin_users;
create policy "Admins can read their own admin record"
  on public.admin_users for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can submit a pending booking request" on public.bookings;
create policy "Anyone can submit a pending booking request"
  on public.bookings for insert
  to anon, authenticated
  with check (status = 'pending');

drop policy if exists "CineFlow admins can view all bookings" on public.bookings;
create policy "CineFlow admins can view all bookings"
  on public.bookings for select
  to authenticated
  using (
    exists (
      select 1 from public.admin_users
      where admin_users.user_id = (select auth.uid())
    )
  );

drop policy if exists "CineFlow admins can update bookings" on public.bookings;
create policy "CineFlow admins can update bookings"
  on public.bookings for update
  to authenticated
  using (
    exists (
      select 1 from public.admin_users
      where admin_users.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.admin_users
      where admin_users.user_id = (select auth.uid())
    )
  );

-- No public SELECT, UPDATE, or DELETE policy exists for bookings.
-- Email and push notification delivery will be added after the booking flow is connected and tested.