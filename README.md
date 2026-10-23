# CineFlow

Booking requests for Cinematiclife.17. Built as a lightweight static website that can be hosted on GitHub Pages.

## Included in this first slice

- Client booking request form for video shoots, editing, sports highlights, events, music videos, photography, and other projects
- Requests stay **pending** until the owner approves them
- Private admin login and dashboard for viewing and updating requests
- Responsive layout for iPhone and desktop
- Supabase Row Level Security policies in `supabase/schema.sql`

## Setup required before accepting real bookings

The GitHub repository currently contains the front end and database schema. It is **not live-connected to Supabase yet**. Do not advertise the form as ready until these steps are complete.

1. Use a dedicated CineFlow Supabase project. Do not reuse the CodeKit project.
2. In that project's SQL Editor, run the contents of `supabase/schema.sql`.
3. In Supabase Authentication, create the owner's admin account using email and password. Keep public sign-ups disabled if the project is dedicated to CineFlow.
4. Copy the user's UUID from Authentication and add it to the admin allowlist by running:
   ```sql
   insert into public.admin_users (user_id)
   values ('PASTE-ADMIN-USER-UUID-HERE');
   ```
5. In Supabase project settings, copy the Project URL and publishable key. Put them in `config.js` as `supabaseUrl` and `supabasePublishableKey`. A publishable/anon key is safe for browser use when RLS is correctly configured. **Never put a service-role or secret key in this repository.**
6. Enable GitHub Pages for the repository, using the `main` branch and root folder.
7. Test a public booking request, then sign in at `admin.html` with the owner's account and confirm the request appears. Verify an unapproved account cannot read or change bookings.

## Status

This is the first booking-focused slice. Email notifications and iPhone web push are not implemented yet; add them after the database connection and approval flow are tested. A client request is not a confirmed booking until the owner approves it.

## Security notes

- Public visitors can only insert a new request with status `pending`.
- Only user IDs explicitly added to `admin_users` can read and update requests.
- No service-role key belongs in browser code.
- The date-conflict check in the dashboard is a helpful warning, not a guarantee against simultaneous approvals. Check the calendar before approving a booking.