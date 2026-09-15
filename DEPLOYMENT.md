# PEA — staging deployment

Everything here is prepared but **not yet run**, because it needs server access
that the build did not have. Hand this to whoever administers the box.

Target server: the same application server that already runs ATS
(`20.207.205.137`). Sharing the server is fine — PEA is a separate application
on its own ports with its **own database**; it shares no data with ATS.

---

## ⚠️ Before anything else

**Ports 5000 and 5001 are taken** by ATS staging and ATS production. PEA uses
**5002** (staging) and **5003** (production). Binding 5000 or 5001 fails with
`EADDRINUSE` and would not touch ATS, but the deploy would simply not start.

**PEA is a separate project from ATS (decision D5, 13 Sep 2026).** ATS covers
hiring; PEA covers probation after joining. PEA reads no ATS data.

#### Database — PEA's own (since 15 Sep 2026)

Host `20.244.34.176:5432`, login **`peauser`** (owner of both databases, no idle-session timeout).

| Environment | Database | Schema created by | Status |
|---|---|---|---|
| Staging (and local development) | `peaStagingDB` | `prisma/ddl/pea-dedicated-database.sql` | ✅ Schema applied and all PEA data copied from `recruitmentautomationdb`, 15 Sep 2026 |
| Production | `peaProductionDB` | `prisma/ddl/pea-dedicated-database.sql` | Empty — apply the file at cutover (step 7) |

- `.env.development` and `.env.staging` point at `peaStagingDB` as `peauser`.
- The old `pea_` tables are still in `recruitmentautomationdb` (the ATS staging
  database) as a fallback. Nothing reads them any more; drop them only after
  UAT sign-off.
- Never run `prisma migrate` / `db push` / `db pull` — the schema is SQL-first.

📧 **Outside production every email goes to `EMAIL_STAGING_RECIPIENTS`, always.**
Since 13 Sep this no longer depends on `EMAIL_REDIRECT_TO_TEST`: the server
refuses to start if that is set to `false` on staging, and the mail transport
itself refuses any other recipient.

---

## 1. IT requests — raise these first, they queue

| # | Request | Blocks |
|---|---|---|
| 1 | Shared mailbox `hr-automation@aapnainfotech.com` — no licence needed for an Exchange shared mailbox under 50 GB. ⚠️ Confirm `.com` vs `.in`: ATS production sends from `recruitment@aapnainfotech.**in**`. | Nothing — PEA falls back to `MS_DEFAULT_SENDER_EMAIL` until it exists |
| 2 | DNS A record `pea-staging.aapnainfotech.com` → the ATS server IP | Go-live |
| 3 | Certbot certificate for that hostname | Go-live |
| 4 | The expiry date of the ATS app-registration client secret | Nothing yet — but when it lapses, **ATS and PEA both stop sending** |

---

## 2. Deploy directories

Matching the ATS convention (`/var/www/html/ats-platform-staging`):

```bash
sudo mkdir -p /var/www/html/pea-staging-aapnainfotech/{backend,frontend}
sudo chown -R atsuser:atsuser /var/www/html/pea-staging-aapnainfotech
```

Copy `PEA-Local/backend` and `PEA-Local/frontend` into place (excluding
`node_modules`, `.env*` and `logs`).

---

## 2b. PEA's database — ✅ done for staging (15 Sep 2026)

IT created `peaStagingDB` and `peaProductionDB` with the login `peauser`.
`peaStagingDB` already has the schema and the data, so **nothing to run for staging.**

For a new, empty PEA database (e.g. `peaProductionDB` at cutover): connect pgAdmin
to it **as `peauser`** and run the whole of `prisma/ddl/pea-dedicated-database.sql`
(Ctrl+A, F5). It creates all 15 tables, seeds the evaluation questions and
settings, and **refuses to run if it finds ATS tables**. The verification grid
at the end should show 15 PEA tables, 0 ATS tables, 18 parameters, 18 settings.

---

## 3. Backend

```bash
cd /var/www/html/pea-staging-aapnainfotech/backend
npm ci --omit=dev
npx prisma generate          # NOT db pull, NOT migrate — see below
```

Create `.env.staging` from `.env.example`. The ones that matter:

```bash
NODE_ENV=staging
PORT=5002
# Percent-encode the password: @ → %40, [ → %5B, ^ → %5E, ( → %28, # → %23 (JavaScript: encodeURIComponent).
DATABASE_URL="postgresql://peauser:<percent-encoded password>@20.244.34.176:5432/peaStagingDB?schema=public&connection_limit=5&pool_timeout=10&connect_timeout=10"
JWT_SECRET=<generate a new one, do NOT reuse the dev placeholder>
FRONTEND_URL=https://pea-staging.aapnainfotech.com
EMAIL_REDIRECT_TO_TEST=true
EMAIL_STAGING_RECIPIENTS=aiautomationn8nuser@gmail.com
PEA_SCHEDULER_ENABLED=true
TZ=Asia/Kolkata
# Cloudflare Turnstile widget for pea-staging.aapnainfotech.com → Secret key
TURNSTILE_SECRET_KEY=<secret key>
```

> 🚨 **Never run `prisma migrate`, `prisma db push`, or `prisma db pull` here.**
> `schema.prisma` is hand-written; schema changes go through a reviewed `.sql`
> file in `prisma/ddl/`.

The app refuses to start if `JWT_SECRET` is still the dev placeholder, if the
email redirect is on with no recipient configured, or if `TURNSTILE_SECRET_KEY`
is empty (the login page's Cloudflare check).

---

## 4. Frontend

```bash
cd /var/www/html/pea-staging-aapnainfotech/frontend
npm ci
npm run build:staging        # → dist/
```

The build reads `frontend/.env.staging`, which must contain the Turnstile
**site key** (it is baked into the bundle, so a change needs a rebuild):

```bash
VITE_API_URL=/api
VITE_TURNSTILE_SITE_KEY=<site key>
```

The Turnstile widget in Cloudflare must list `pea-staging.aapnainfotech.com`
as a hostname, or the login box shows an error and nobody can sign in.
Locally, both `.env.development` files use Cloudflare's always-pass test keys.

---

## 5. nginx

`/etc/nginx/sites-available/pea-staging` — modelled on the ATS block, minus the
Socket.io section (PEA has no websockets):

```nginx
server {
    listen 80;
    server_name pea-staging.aapnainfotech.com;
    client_max_body_size 50M;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name pea-staging.aapnainfotech.com;
    client_max_body_size 50M;

    ssl_certificate     /etc/letsencrypt/live/pea-staging.aapnainfotech.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pea-staging.aapnainfotech.com/privkey.pem;

    root  /var/www/html/pea-staging-aapnainfotech/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:5002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/pea-staging /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`X-Forwarded-For` matters: the app sets `trust proxy`, and the evaluation form
records the submitter's IP.

---

## 6. Start

```bash
cd /var/www/html/pea-staging-aapnainfotech/backend
pm2 start ecosystem.config.cjs --only pea-staging-backend
pm2 save
pm2 logs pea-staging-backend --lines 50
```

Expected on boot:

```
✅ Database connected: "peaStagingDB" (15 PEA tables)
🚀 PEA Backend listening on port 5002 [staging]
📧 Non-prod email guard ACTIVE — all mail redirected to: aiautomationn8nuser@gmail.com
⏰ Scheduler started — "0 11 * * *" (Asia/Kolkata)
```

Seed the first admin:

```bash
PEA_ADMIN_PASSWORD='<something strong>' npm run seed:admin
```

---

## 7. Production (at cutover, not now)

1. **Production database `peaProductionDB`:** connect as `peauser` and run
   `prisma/ddl/pea-dedicated-database.sql`, as step 2b. It starts empty; the real
   master sheet is imported on go-live day (section 9). Then seed the first admin.
2. `.env.production` — `PORT=5003`, `DATABASE_URL` for `peaProductionDB` as `peauser`,
   `EMAIL_REDIRECT_TO_TEST=false`, a distinct `JWT_SECRET`.
3. nginx block for `pea.aapnainfotech.com` → `localhost:5003`.
4. `pm2 start ecosystem.config.cjs --only pea-prod-backend`.

---

## 8. Verify

```bash
curl -s https://pea-staging.aapnainfotech.com/api/health | jq
```

Then, signed in, `GET /api/admin/diagnostics` — it lists every reason mail would
not be sent, plus a live Graph connectivity check. On a correct staging build it
should report:

```
blockers:
  · non-prod guard on — mail is diverted to aiautomationn8nuser@gmail.com
```

That is the **intended** staging state: PEA sends every email, and all of them
land in the test inbox. On production that line disappears and mail goes to the
real people. If `"Pause all email" (shadow_mode) is on` appears, switch it off
in Settings → Email.

---

## 9. Going live — the order that matters

**HR decision, 13 Sep: no shadow period. PEA sends every email itself** —
staging to `EMAIL_STAGING_RECIPIENTS`, production to the real people.
`shadow_mode` is kept only as an emergency "Pause all email" switch and is off.

**Decision (13 Sep): one go-live day. Power Automate is stopped completely, and
from that day PEA is the only system** — no parallel run.

### What could go wrong — and what prevents it

| # | Risk | Prevention |
|---|---|---|
| 1 | Power Automate and PEA both send on the same day | **All** Power Automate flows off (step 3) **before** PEA's scheduler is on (step 8) |
| 2 | The sheet changes after it is downloaded | Flows off **first**, sheet downloaded **after** (steps 3 → 4) |
| 3 | A manager opens an old MS Forms link and answers into nothing | MS Forms set to **not accept responses** (step 3). PEA sends a fresh link for every unanswered evaluation due in the last 45 days (**built** — listed in the preview) |
| 4 | Old rows with no decision get emailed | Importer sets them to **Confirmed** (**built** — joined 8+ months ago, blank or "Extend") |
| 5 | Wrong project leader CC'd | RM→PL map rebuilt after import, `ragupta@` → `aroy@` set by hand (step 6) |
| 6 | Emails go out with empty HR / IT / CC lists | Settings filled in the day before (step 2); diagnostics checked (step 7) |

### Before go-live

- UAT on staging with HR — every email lands in the test inbox.
- **Rehearse the import on staging** with the latest sheet: read both preview
  lists ("Old rows → Confirmed", "Unanswered MS Forms links") with HR.
- Pick a **Monday–Thursday** for go-live (the sweep runs at 11:00 IST).

### Go-live — in this order

| Step | When | Who | Action |
|---|---|---|---|
| 1 | Day before | HR | Email all reporting managers: *"From tomorrow, evaluation emails come from PEA. The old MS Forms links stop working — if you had one open, you will get a new link."* |
| 2 | Day before | Admin | Deploy production: `NODE_ENV=production`, **`PEA_SCHEDULER_ENABLED=false`**. In Settings fill `cc_emails`, `hr_notification_emails`, `it_report_emails`; self-view `averages`; "Pause all email" **off**. |
| 3 | Go-live, before 11:00 | Power Automate owner | Turn **OFF all five** flows: `Sending Evaluation Form Link Flow V2`, `Sending Evaluation Reminders`, `Adhoc Flow`, `Submitted Response flow – Fresher`, `– Experience`. **Disable, do not delete.** In MS Forms, turn off **Accept responses** on both forms. |
| 4 | | HR | Download the master sheet (only after step 3). Keep it as a read-only archive from now on. |
| 5 | | Admin | **Import sheet** → Preview → check both lists → Dry run → Import. |
| 6 | | Admin | **Rebuild RM→PL map**, then set `ragupta@` → `aroy@` by hand. |
| 7 | | Admin | `GET /api/admin/diagnostics` — no blockers except the scheduler. `POST /api/admin/sweep?dryRun=true` — read the list of who gets an email at 11:00. |
| 8 | | Admin | Set `PEA_SCHEDULER_ENABLED=true`, `pm2 restart pea-prod-backend`. |
| 9 | After 11:00 | Admin + HR | Check the email log: sent, not failed. Ask one or two managers to confirm they received it. |
| 10 | Later | HR | Keep the exported flow zips and the final sheet permanently — they are the only copy of the old process. |

**Rollback (about ten minutes)** — only if PEA cannot send at all: switch on
**"Pause all email"**, turn the five flows and the MS Forms back on, and tell HR
to use the sheet again. Anything recorded in PEA meanwhile must be copied into
the sheet by hand. Agree the trigger in advance: *the sweep fails two days
running, or evaluation emails are not reaching managers.*

---

## 10. Still open before go-live

| Item | Who |
|---|---|
| ✅ Reminder timing — answered 13 Sep: HR sets it in Settings → Evaluations. `2,4` is the starting value. | HR |
| ✅ CC list — answered 13 Sep: HR sets it in Settings → Email. | HR |
| ✅ Rating labels — answered 13 Sep: keep the email-table wording. | HR |
| After the sheet import: set `ragupta@` → `aroy@` as a manual RM→PL entry (Decision 14). | admin |
| Settings to apply after import: Employee self-view = `averages`; Azure field sync on (after a dry-run scan); deadline digest on **only after** the Decision 16 "historical" mark is built. | admin |
| Import the real master sheet — **Import sheet** screen: preview → dry run → import, and sign off the reconciliation report. (If PEA moves database afterwards, import again there.) | HR + admin |
| ✅ Move PEA to its own database — done 15 Sep: `peaStagingDB` (schema + data), `peaProductionDB` (empty, schema at cutover). Drop the old `pea_` tables from `recruitmentautomationdb` after UAT sign-off. | DBA |
| Review the 45-day stale-cycle cutoff against the real sheet — it decides how many historical cycles go live vs are closed. | HR + dev |
