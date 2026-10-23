# CineFlow

Booking requests for Cinematiclife.17. Built as a lightweight static website that can be hosted on GitHub Pages.

## Included

- Client booking request form for video shoots, editing, sports highlights, events, music videos, photography, and other projects
- Requests stay **pending** until the owner approves them
- Private admin login and dashboard for viewing and updating requests
- Responsive layout for iPhone and desktop
- Supabase database tables and Row Level Security policies

## Supabase connection status

The dedicated CineFlow Supabase project is connected in `config.js`, and the initial schema has been applied. The CodeKit Supabase project is separate and must not be modified for CineFlow.

### Still required before accepting real bookings

1. In Supabase Authentication, create the owner's admin account using an email and password. Do not share the password in chat.
2. Copy that user's UUID from Authentication and add it to the admin allowlist in the CineFlow SQL Editor:
   ```sql
   insert into public.admin_users (user_id)
   values ('PASTE-ADMIN-USER-UUID-HERE');
   ```
3. Enable GitHub Pages for this repository using the `main` branch and root folder, if it is not already enabled.
4. Test a public booking request, then sign in at `admin.html` and confirm the request appears. Verify a non-admin account cannot read or change bookings.

## Not implemented yet

Email notifications and iPhone web push are not implemented. Add these after the booking submission and admin approval flow have been tested. A client request is not a confirmed booking until the owner approves it.

## Security notes

- Public visitors can only insert a new request with status `pending`.
- Only user IDs explicitly added to `admin_users` can read and update requests.
- The project URL and publishable key in `config.js` are intended for browser use. Never put a service-role key or secret key in this repository.
- The date-conflict check in the dashboard is a helpful warning, not a guarantee against simultaneous approvals. Check the calendar before approving a booking.
