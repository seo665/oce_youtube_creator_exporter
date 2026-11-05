# Creator CRM

Private CRM for the single OnlyFans-related YouTube search run from November 5, 2026. The app does not import historical search files automatically; the admin imports only `oce_youtube_creator_leads_2026-11-05_13-10-16.csv` from the existing `exports` folder.

## What is included

- Email-and-password sign-in for invited accounts only, with email-based password setup and recovery.
- Admin and worker roles. Admins see every lead and can assign leads; workers see and update only leads assigned to them.
- Search and status filters, lead details, team notes, assignment, and follow-up dates.
- Due and overdue follow-ups are highlighted in the dashboard. The app does not send reminder or outreach emails.
- CSV export for the records visible to the signed-in user.
- Row-level security in Supabase; the service-role key is used only by the server to send worker invitations.

## Services and access you need

1. A GitHub account connected to this repository.
2. A Vercel account to deploy the `crm-dashboard` folder.
3. A Supabase project for database and authentication.
4. The complete email address for the admin. The worker's full email can be added later from the admin dashboard.
5. Configure Supabase email delivery. Its default email service is rate-limited; for reliable invitations and one-time codes, connect a custom SMTP provider.

Do not send passwords, Supabase keys, or SMTP credentials in chat. The service-role key is private and must never use a `NEXT_PUBLIC_` variable name.

## Supabase setup

1. Create a Supabase project and choose a region appropriate for your users.
2. In the Supabase SQL Editor, run `supabase/schema.sql`.
3. In Authentication settings, disable public sign-ups. The admin will invite any workers.
4. Add the deployed app URL to Authentication's site URL and redirect URL allow-list. Include the callback URL ending in `/auth/callback`.
5. Invite the admin email from Supabase Authentication → Users. Use the app's callback URL with `?next=/auth/update-password` as the invite redirect so the admin can set a password after verifying the email. The database trigger creates a worker profile for invited users by default.
6. Promote the admin profile in the SQL Editor, replacing the example with the admin's complete email:

   ```sql
   update public.profiles
   set role = 'admin'
   where lower(email) = lower('admin@example.com');
   ```

The admin can invite the worker from the CRM once signed in. The worker follows the invitation link to set an initial password. Worker profiles are created automatically and cannot grant themselves admin access. Existing accounts can use “Forgot or need to set your password?” on the sign-in page to set or recover their password.

## Local development

From `crm-dashboard`:

```powershell
npm install
Copy-Item .env.example .env.local
```

Set these values in `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Run the app:

```powershell
npm run dev
```

Open `http://localhost:3000`.

## Vercel deployment

1. Import this GitHub repository into Vercel.
2. Set **Root Directory** to `crm-dashboard`.
3. Add the four environment variables listed above. For `NEXT_PUBLIC_APP_URL`, use the deployed Vercel URL.
4. Deploy, then update Supabase's site URL and callback allow-list to use that URL.
5. Sign in as the admin and import **only** `exports/oce_youtube_creator_leads_2026-11-05_13-10-16.csv`. The CRM rejects other filenames; duplicate channel IDs are skipped without overwriting existing notes or assignments.
6. Invite the worker from the CRM when their full email address is available.

The CSV and its public contact details are not bundled into the application or committed to the repository. They are inserted into the private Supabase database after an admin uploads the file. Only public creator contact information is present in the search export; follow applicable privacy rules and each creator's contact preferences.

## Validation

```powershell
npm run lint
npm run typecheck
npm run build
```
