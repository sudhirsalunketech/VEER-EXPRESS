# Deployment: Vercel + Render + Supabase

Nothing below is done automatically. Every step creates resources in your own accounts, so run each one deliberately. The free tiers are enough for the demo.

## 1. Frontend demo (Vercel), the only step needed for the client presentation

1. Import the repo in Vercel and set **Root Directory** to `apps/web`.
2. Framework: Vite. Build command `npm run build`, output `dist`. Vercel installs the workspace from the repo root.
3. Env: `VITE_APP_MODE=demo`.
4. `apps/web/vercel.json` already rewrites all paths to `index.html` for client-side routing.

## 2. Database (Supabase)

1. Create a project in the region closest to your users (e.g. Mumbai).
2. Apply the migrations with `supabase link --project-ref <ref> && supabase db push`, or run each file in `supabase/migrations/` **in filename order** in the SQL editor.
3. Demo/staging only: `DATABASE_URL=<connection string> npm run db:seed`.
4. Production: do **not** seed. Create the first Super Admin with a one-off SQL insert using a bcrypt hash.

## 3. API (Render)

1. New, then Blueprint, then select this repo. `render.yaml` defines `veer-express-api`.
2. Set `CORS_ORIGINS` to the Vercel URL. Set `DATABASE_URL` to the Supabase pooler URI. Generate `CREDENTIAL_ENCRYPTION_KEY`.
3. Keep `APP_MODE=demo` until the DB is ready, then switch to `development` (staging) or `production`.
4. Check `GET https://<service>.onrender.com/api/v1/health`.
5. Point the web app at it: `VITE_APP_MODE=production`, `VITE_API_URL=https://<service>.onrender.com`.

Note: Render's free web services sleep when idle, so the first request after a pause is slow. For live client meetings, use the Vercel demo (step 1), which needs no backend.

## Going live checklist

- [ ] Strong `JWT_SECRET` (the API refuses to start in production without ≥ 32 chars)
- [ ] Demo users removed or disabled; `is_demo` rows purged
- [ ] Razorpay test keys verified end to end, then live keys after business approval
- [ ] Each courier adapter verified in the partner sandbox before `environment = PRODUCTION`
- [ ] WhatsApp/SMS providers approved (DLT templates for SMS in India)
- [ ] Privacy Policy and Terms reviewed by a legal professional
- [ ] Supabase backups / PITR enabled
