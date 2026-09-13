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

#### Database — interim now, PEA's own later

| Phase | Database | Login | Schema created by |
|---|---|---|---|
| **Now — interim** (IT/DBA not available) | `recruitmentautomationdb` | `appuser` | The 3 dated DDL files — **already applied** |
| **Later — target** | PEA's own (`pea_staging` / `pea_production`, names to confirm) | `peauser` | `prisma/ddl/pea-dedicated-database.sql` |

- **Interim:** PEA's `pea_` tables sit in the same database as the ATS `rpa_`
  tables, but PEA never queries them. `.env.development` and `.env.staging`
  already point here — **nothing to create or run for the Monday deployment.**
- **Later:** when the DBA is available, follow step 2b. PEA is not live, so the
  new database can start clean and the real sheet is imported into it.
- ⚠️ **While on the interim database**, `prisma migrate` / `db push` / `db pull`
  remain genuinely dangerous: `appuser` owns the ATS tables, and Prisma would
  treat them as drift and drop them. Never run those commands.

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

## 2b. Create PEA's own database — LATER, not for the interim deployment

> ⏭️ **Skip this step for now.** The interim deployment uses
> `recruitmentautomationdb`, which already has PEA's tables. Do this when the
> DBA is available and PEA moves to its own database. Note the DDL below
> **refuses** to run inside `recruitmentautomationdb` — by design.

Someone with `CREATEDB` (the DBA):

```sql
CREATE DATABASE pea_staging;

-- Recommended: a login that can only touch PEA's database.
CREATE ROLE peauser WITH LOGIN PASSWORD '<generate a strong one>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE pea_staging TO peauser;
```

Then connect pgAdmin **to `pea_staging`** and run the whole of
`prisma/ddl/pea-dedicated-database.sql` (Ctrl+A, F5). It creates all 14 tables,
seeds the evaluation questions and settings, grants `peauser` its rights, and
**refuses to run if it finds ATS tables** — so it cannot be applied to the
wrong database by mistake. The verification grid at the end should show
14 PEA tables, 0 ATS tables, 18 parameters, 18 settings.

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
# INTERIM: the same value as the repo's .env.staging. Percent-encode the password (# → %23, @ → %40).
DATABASE_URL="postgresql://appuser:<password>@20.244.34.176:5432/recruitmentautomationdb?schema=public&connection_limit=5&pool_timeout=10&connect_timeout=10"
# LATER (after step 2b): postgresql://peauser:<password>@<db-host>:5432/pea_staging?...
JWT_SECRET=<generate a new one, do NOT reuse the dev placeholder>
FRONTEND_URL=https://pea-staging.aapnainfotech.com
EMAIL_REDIRECT_TO_TEST=true
EMAIL_STAGING_RECIPIENTS=aiautomationn8nuser@gmail.com
PEA_SCHEDULER_ENABLED=true
TZ=Asia/Kolkata
```

> 🚨 **Never run `prisma migrate`, `prisma db push`, or `prisma db pull` here.**
> On the interim database `appuser` owns the ATS tables; Prisma would read them
> as drift and emit `DROP TABLE` for each — successfully. `schema.prisma` is
> hand-written; schema changes go through a reviewed `.sql` file in `prisma/ddl/`.

The app refuses to start if `JWT_SECRET` is still the dev placeholder, or if the
email redirect is on with no recipient configured.

---

## 4. Frontend

```bash
cd /var/www/html/pea-staging-aapnainfotech/frontend
npm ci
npm run build:staging        # → dist/
```

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
✅ Database connected: "recruitmentautomationdb" (14 PEA tables)
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

1. **Decide the production database before cutover:**
   - **Preferred:** PEA's own `pea_production` — `CREATE DATABASE`, then
     `prisma/ddl/pea-dedicated-database.sql`, as step 2b.
   - **Interim fallback, if the DBA is still unavailable:** the three dated DDL
     files, in order, against `recruitmentautomationdbProd` — as was done for staging.
2. `.env.production` — `PORT=5003`, `DATABASE_URL` for the chosen database,
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
  · shadow_mode is true — nothing is sent
  · non-prod guard on — mail is diverted to aiautomationn8nuser@gmail.com
willActuallySendEmail: false
```

That is the **intended** staging state.

---

## 9. Going live — the order that matters

PEA ships with three independent brakes on. Releasing them one at a time is what
makes the cutover reversible (migration plan R6).

| Stage | Action | Duration |
|---|---|---|
| **1. Shadow** | Leave `shadow_mode = 'true'`. PEA writes what it *would* have sent to `pea_email_log`; Power Automate stays live and authoritative. Compare daily via `GET /api/admin/shadow-report`. | 3–5 days |
| **2. Cutover** | Three clean days? Set `shadow_mode = 'false'` and **turn off only the Power Automate scheduler flow**. Leave the response flows on so any MS Forms link already in someone's inbox still works. | 2 weeks |
| **3. Retire** | Disable the remaining flows. Keep the exported zips permanently — they are the only copy of the original logic. | — |

```sql
-- Release the shadow brake (stage 2)
UPDATE pea_settings SET setting_value = 'false' WHERE setting_key = 'shadow_mode';
```

**Rollback is re-enabling the Power Automate scheduler flow — about ten minutes.**
Agree the trigger in advance: *if the sweep fails two days running, or any
evaluation email fails to reach a manager, re-enable the flow and investigate
offline.* Do not delete the flows or stop maintaining the master sheet until
stage 3.

---

## 10. Still open before go-live

| Item | Who |
|---|---|
| Confirm reminder timing (+2 / +4 days). The reminder flow was never exported, so this is reconstructed from the PPT user guide. | HR |
| Confirm the CC list `sroy@, rsomani@, sshukla@, smaiti@` — lifted verbatim from the hardcoded flow value and editable for the first time. | HR |
| Confirm which rating labels go on the form. The email says "Satisfied (Sometimes Exceeds Expectation)"; the old MS Form said "3- Satisfactory to above average". They drifted apart. | HR |
| Import the real master sheet — **Import sheet** screen: preview → dry run → import, and sign off the reconciliation report. (If PEA moves database afterwards, import again there.) | HR + admin |
| Move PEA to its own database (step 2b) — names `pea_staging` / `pea_production` proposed. Interim: `recruitmentautomationdb`. | DBA |
| Review the 45-day stale-cycle cutoff against the real sheet — it decides how many historical cycles go live vs are closed. | HR + dev |
