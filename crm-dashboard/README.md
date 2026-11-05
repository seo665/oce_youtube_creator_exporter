# Creator CRM

Private workspace for running YouTube creator research campaigns and organizing the resulting leads. Admins can group up to 30 search phrases into a campaign; each phrase is searched through the official YouTube Data API, and results are saved as the campaign runs so an interrupted campaign can be resumed.

## What is included

- Email-and-password sign-in for invited accounts only, with email-based password setup and recovery.
- Admin and worker roles. Admins see every lead and can assign leads; workers see and update only leads assigned to them.
- Search and status filters, including a split between leads with a listed public email and leads needing manual email research. Separate filters flag repeat creators and put results whose matched titles/descriptions do not mention “OnlyFans” into a relevance-review bucket. Search phrases themselves do not determine this classification, and review leads remain in the pool. CSV exports follow the active filters and include duplicate and relevance labels.
- Campaign history records the phrases used, completion progress, lead totals, and duplicate matches.
- Public emails are extracted only from YouTube channel descriptions. The app does not verify email addresses or send outreach.
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
2. In the Supabase SQL Editor, run `supabase/schema.sql`. If the existing CRM is already set up, run the updated schema again to add the campaign tables and fields.
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
YOUTUBE_API_KEY=your-server-only-youtube-data-api-key
```

Enable the YouTube Data API v3 in Google Cloud and create an API key with access to that API. Keep the key server-only; never use a `NEXT_PUBLIC_` prefix or paste the key into chat. YouTube search requests use about 100 quota units each, plus a small amount for channel metadata. Searching both channels and videos uses about 200 units per phrase. The campaign form displays an estimate before starting.

Run the app:

```powershell
npm run dev
```

Open `http://localhost:3000`.

## Vercel deployment

1. Import this GitHub repository into Vercel.
2. Set **Root Directory** to `crm-dashboard`.
3. Add the Supabase and app URL variables above, plus `YOUTUBE_API_KEY`, to Vercel's server environment variables. For `NEXT_PUBLIC_APP_URL`, use the deployed Vercel URL.
4. Deploy, then update Supabase's site URL and callback allow-list to use that URL.
5. Sign in as the admin and create a campaign. Paste one phrase per line, choose the search mode and result limit, then start. Completed phrases are saved individually; resume an interrupted campaign from Campaign history.
6. Invite the worker from the CRM when their full email address is available.

Campaigns keep a unique lead for each YouTube channel. When the same channel appears in a later campaign, the app increments its campaign count and marks it as a repeat; matches found again within one campaign add search phrases without inflating the repeat count. Matched result titles and descriptions are retained across searches so the relevance-review bucket considers the channel’s accumulated search matches.

## Validation

```powershell
npm run lint
npm run typecheck
npm run build
```
