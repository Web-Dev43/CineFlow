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
  event_name text not null check (char_length(trim(event_name)) between 1 and 120),
  requested_date date not null,
  requested_time time not null,
  location text not null check (char_length(trim(location)) between 1 and 200),
  budget_range text,
  referral_source text,
  project_details text not null check (char_length(trim(project_details)) between 1 and 3000),
  status text not null default 'pending' check (status in ('pending','read','approved','declined','cancelled')),
  decline_reason text,
  agreed_price numeric(10,2) check (agreed_price is null or agreed_price >= 0),
  payment_status text not null default 'not_requested' check (payment_status in ('not_requested','awaiting_payment','awaiting_verification','paid_verified','refunded','disputed')),
  client_push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_created_at_idx on public.bookings (created_at desc);
create index if not exists bookings_requested_date_idx on public.bookings (requested_date);
create index if not exists bookings_status_idx on public.bookings (status);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  subscription jsonb not null,
  audience text not null check (audience in ('admin','client')),
  user_id uuid references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (
    (audience = 'admin' and user_id is not null and booking_id is null)
    or
    (audience = 'client' and user_id is null and booking_id is not null)
  )
);
create index if not exists push_subscriptions_audience_idx on public.push_subscriptions (audience);
create index if not exists push_subscriptions_booking_idx on public.push_subscriptions (booking_id);

create table if not exists public.push_notification_events (
  event_key text primary key,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.bookings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_notification_events enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.bookings to anon, authenticated;
grant select, update on public.bookings to authenticated;
grant select on public.admin_users to authenticated;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_notification_events from anon, authenticated;

drop policy if exists "Admins can read their own admin record" on public.admin_users;
create policy "Admins can read their own admin record"
  on public.admin_users for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can submit a pending booking request" on public.bookings;
drop policy if exists "Anyone can submit an accepted booking" on public.bookings;
drop policy if exists "Anyone can submit a new booking request" on public.bookings;
create policy "Anyone can submit a new booking request"
  on public.bookings for insert to anon, authenticated
  with check (status = 'pending');

drop policy if exists "CineFlow admins can view all bookings" on public.bookings;
create policy "CineFlow admins can view all bookings"
  on public.bookings for select to authenticated
  using (exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  ));

drop policy if exists "CineFlow admins can update bookings" on public.bookings;
create policy "CineFlow admins can update bookings"
  on public.bookings for update to authenticated
  using (exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.admin_users
    where admin_users.user_id = (select auth.uid())
  ));

-- Push tables have no browser policies; only the server-side Edge Function accesses them.
