# PEA — staging deployment

Everything here is prepared but **not yet run**, because it needs server access
that the build did not have. Hand this to whoever administers the box.

Target server: the same one that already runs ATS (`20.207.205.137`).

---

## ⚠️ Before anything else

**Ports 5000 and 5001 are taken** by ATS staging and ATS production. PEA uses
**5002** (staging) and **5003** (production). Binding 5000 or 5001 fails with
`EADDRINUSE` and would not touch ATS, but the deploy would simply not start.

**Two databases exist**, differing only by name:

| Environment | Database |
|---|---|
| ATS + PEA staging | `recruitmentautomationdb` |
| ATS + PEA production | `recruitmentautomationdbProd` |

The PEA DDL has been applied to **staging only**. Production is step 7.

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
sudo mkdir -p /var/www/html/pea-platform-staging/{backend,frontend}
sudo chown -R atsuser:atsuser /var/www/html/pea-platform-staging
```

Copy `PEA-Local/backend` and `PEA-Local/frontend` into place (excluding
`node_modules`, `.env*` and `logs`).

---

## 3. Backend

```bash
cd /var/www/html/pea-platform-staging/backend
npm ci --omit=dev
npx prisma generate          # NOT db pull, NOT migrate — see below
```

Create `.env.staging` from `.env.example`. The values are in the repo's
`.env.staging`; the ones that matter:

```bash
NODE_ENV=staging
PORT=5002
DATABASE_URL="postgresql://appuser:Hbg%23bs%40m%40kdirbA@20.244.34.176:5432/recruitmentautomationdb?schema=public&connection_limit=5&pool_timeout=10&connect_timeout=10"
JWT_SECRET=<generate a new one, do NOT reuse the dev placeholder>
FRONTEND_URL=https://pea-staging.aapnainfotech.com
EMAIL_REDIRECT_TO_TEST=true
EMAIL_STAGING_RECIPIENTS=aiautomationn8nuser@gmail.com
PEA_SCHEDULER_ENABLED=true
TZ=Asia/Kolkata
```

> 🚨 **Never run `prisma migrate`, `prisma db push`, or `prisma db pull` here.**
> PEA's `pea_` tables share the `public` schema with 48 ATS `rpa_` tables, and
> the app connects as `appuser`, which **owns** them. Prisma would read those 48
> tables as drift and emit `DROP TABLE` for each — successfully.
> `schema.prisma` is hand-written; schema changes go through a reviewed file in
> `prisma/ddl/`. `package.json` deliberately has no migrate script.

The app refuses to start if `JWT_SECRET` is still the dev placeholder, or if the
email redirect is on with no recipient configured.

---

## 4. Frontend

```bash
cd /var/www/html/pea-platform-staging/frontend
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

    root  /var/www/html/pea-platform-staging/frontend/dist;
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
cd /var/www/html/pea-platform-staging/backend
pm2 start ecosystem.config.cjs --only pea-staging-backend
pm2 save
pm2 logs pea-staging-backend --lines 50
```

Expected on boot:

```
✅ Database connected (48 ATS tables intact)
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

1. Apply `prisma/ddl/2026-09-12-pea-core.sql` to **`recruitmentautomationdbProd`**.
   The script's own guard accepts both database names and aborts on anything else.
2. `.env.production` — `PORT=5003`, the Prod database, `EMAIL_REDIRECT_TO_TEST=false`,
   a distinct `JWT_SECRET`.
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
| Import the real master sheet (the demo file has 3 rows). Use `POST /api/import/preview` first and sign off the reconciliation report. | HR + dev |
| Review the 45-day stale-cycle cutoff against the real sheet — it decides how many historical cycles go live vs are closed. | HR + dev |
