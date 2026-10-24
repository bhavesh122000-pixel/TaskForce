# Running TaskForce with Supabase

The default `npm start` now uses Supabase PostgreSQL and a private Supabase Storage bucket. It does not read or migrate `data/taskforce.db`. The existing task, conveyancing, taxation, calendar, callback, time and account rules remain in the shared engine.

## Local use

1. Install Node.js 24 and run `npm ci`.
2. Put the values shown in `.env.example` into `.env.local`. This file is ignored by Git. The current machine is already configured with the corrected project.
3. For a new installation, run `npm run setup:supabase`. This creates the schema, initial application admin and private file bucket. It preserves existing accounts, passwords and records when rerun.
4. Run `npm start` and open `http://localhost:3000`.

The application admin is **Bhavesh**, `bhavesh122000@gmail.com`, with the password supplied during setup. Sign in and open **Admin → Staff** to create employees and additional admins. Public setup is disabled in Supabase mode. These accounts use the app's original password/session system; they do not appear in Supabase Authentication's user list.

App records are in the `taskforce_app` schema. There are 24 business tables and one private, temporary upload-grant table. The built-in checklist library and South Australian holidays are initialized from the existing engine on first start. They are application defaults, not imported test records. Matters, tasks and employees start empty.

Attachments go into the private bucket named by `SUPABASE_STORAGE_BUCKET`. Temporary local files are removed after upload or email parsing. Download authorization uses the same API permission checks, followed by a signed storage URL valid for 60 seconds. Browser uploads use signed upload URLs to preserve the existing 100 MB application limit without sending file bodies through Vercel Functions. Supabase's project-wide storage limit must also allow the desired size; [Free projects are limited to 50 MB per file](https://supabase.com/docs/guides/storage/uploads/file-limits).

Database TLS verifies the server certificate and hostname using the bundled Supabase public CA certificate. No private key is included in the certificate file. Both the database password and the Supabase server key belong only in server environment variables.

## Vercel

Import this directory as the repository root. The checked-in `vercel.json` sets the build command, static directory, API rewrite and protected background job endpoint. Node.js is pinned to 24.x.

Set these environment variables in Vercel:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The corrected project's **transaction pooler** connection string, with the database password URL-encoded. No named prepared statements are used. |
| `SUPABASE_URL` | The corrected project's HTTPS URL |
| `SUPABASE_SECRET_KEY` | The server-only key |
| `SUPABASE_DB_SCHEMA` | `taskforce_app` |
| `SUPABASE_STORAGE_BUCKET` | The same private bucket used locally |
| `TZ` | The office timezone, matching local use |
| `CRON_SECRET` | A long random secret, also used by Vercel Cron |

The publishable key and JWKS URL are not needed by the app's existing custom login system. Do not put the server key or database URL in public/frontend variables.

The original background-job frequency is every ten minutes. The supplied cron schedule preserves that frequency and requires Vercel Pro or another scheduler capable of calling `/api/cron` every ten minutes with `Authorization: Bearer <CRON_SECRET>`. [Vercel Hobby's once-daily cron frequency](https://vercel.com/docs/cron-jobs/usage-and-pricing) does not preserve the existing alert timing.

Use a separate Supabase project for preview deployments. A preview configured with production credentials will intentionally read and write the same production records. Run `npm run setup:supabase` against the intended project's credentials before its first deployment. No deployment has been performed by these changes.

## Backups and verification

The existing **Back up now** action and `npm run backup` save a JSON database snapshot and copies of referenced attachments under `backups/` in the private bucket. The retention setting controls the number of cloud backup folders. The office PC backup-folder setting does not select a local destination in Supabase mode. Cloud backup files contain private app data and must remain private.

`npm test` checks SQLite and PostgreSQL workflows, permissions, repeat tasks, Taxation, callbacks, time tracking, uploads, email extraction and cloud backups. PostgreSQL tests use an isolated in-memory runtime. `npm run build` validates JavaScript and Vercel configuration; the existing frontend needs no compilation.

For the original office database explicitly set `TF_BACKEND=sqlite`. It uses `data/taskforce.db` and local attachments. Switching backends does not synchronize or transfer records between them. The original README's SQLite backup/restore instructions apply only to that mode.
