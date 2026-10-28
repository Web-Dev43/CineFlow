# CineFlow Security & Backup Runbook

This document contains recovery steps for CineFlow. It must never contain database exports, passwords, API secrets, service-role keys, EmailJS private keys, or VAPID private keys. **Do not commit backup files to this public repository.**

## Current safeguards

- The `public.bookings` table has Row Level Security (RLS) enabled. Anonymous visitors may insert pending booking requests; reading and updating bookings is restricted to authenticated users listed in `public.admin_users`.
- `public.developer_reports` has public insert validation and developer-only read/update policies.
- `public.push_subscriptions` and `public.push_notification_events` have RLS enabled with no client policies. Keep them inaccessible to browser clients; the Edge Functions use server-side credentials for their authorized operations.
- `admin.html` and `developer_inbox.html` are public static files. Their login screens are not the security boundary; Supabase RLS and the server-side identity checks are.
- `config.js` may contain only the Supabase project URL, publishable key, and public VAPID key. Never put private/service-role credentials in browser files.

## Manual backup (Free plan)

Supabase's current documentation says daily managed database backups are included on Pro, Team, and Enterprise plans; Free projects should regularly export data and keep an off-site copy. This project is currently on the Free plan, so do not assume dashboard point-in-time recovery or daily backups are available.

1. Open the Supabase Dashboard for the CineFlow project and use **Connect** to get a database connection string. Treat it as a password: never paste it into chat, a public issue, or a repository.
2. On a trusted computer with Docker and the Supabase CLI installed, set the connection string in your terminal's private environment. Avoid saving it in shell history or a shared script.
3. Export the roles, schema, and data as separate files:

```sh
supabase db dump --db-url "$CINEFLOW_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$CINEFLOW_DB_URL" -f schema.sql
supabase db dump --db-url "$CINEFLOW_DB_URL" -f data.sql --use-copy --data-only
```

4. Store the three files in a private, encrypted location outside GitHub. Keep dated copies in at least two separate locations. Limit access because exports can contain booking contact details and authentication records.
5. Back up Edge Function source and document the *names* of required secrets separately. Do not export or store secret values in the repository. Keep a record of Auth settings, redirect URLs, and enabled integrations.

## Restore test

Do not test a restore against the live CineFlow database. Restore into a separate, isolated PostgreSQL/Supabase test project, using Supabase's official backup/restore instructions. Verify that tables, constraints, RLS policies, admin/developer access, and representative records are present before considering the backup usable. Restore database data alone does not restore Storage objects, Edge Function deployments, secret values, or all Auth provider settings; configure those separately.

After a test restore, check that:
- Anonymous visitors can submit a pending booking but cannot read or change existing bookings.
- Only the configured admin account can view/update bookings.
- Only the configured developer account can view/update developer reports.
- Push subscription/event tables remain unavailable to browser clients.
- Booking emails and phone push notifications work in a controlled test.

## Security follow-up

- Review the Supabase Security Advisor regularly:
  https://supabase.com/dashboard/project/unjsqhhiaogcircfxjwm/advisors/security
- The Security Advisor currently reports leaked-password protection disabled. Supabase's current docs say leaked-password protection is available on Pro and above. Do not upgrade or enable a paid feature without explicitly reviewing the cost first.
- The Security Advisor also reports RLS-enabled push tables without policies. This is expected for direct client access only if all legitimate access remains in server-side Edge Functions; do not add broad public policies merely to silence the warning.
- Keep Supabase Edge Function secrets in Supabase's secret store and never expose service-role/secret keys in client code.
- Before any schema/policy change, capture a fresh backup and confirm the restore path. A backup is only proven after a restore test.

## Official references

- Database backups: https://supabase.com/docs/guides/platform/backups
- Backup/restore with the CLI: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Password security: https://supabase.com/docs/guides/auth/password-security
- RLS enabled without policies: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
