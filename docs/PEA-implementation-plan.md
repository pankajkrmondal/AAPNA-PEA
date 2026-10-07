# PEA — implementation plan for the review points

Source: `docs/PEA-review-points.md` (answers as of 01-10-2026).
Paths below are relative to `AAPNA-PEA/`.

---

## 1. What is in and what is out

| Decision | Points |
|---|---|
| **Build** | B1 B2 B3 B5 B6 B7 B8 · M2 M3 M6 M7 · M8 (copy from the previous evaluation, in HR entry) · P8 P10 P11 · L7 (notes only) · U1–U13 · H2–H9 |
| **Already there** | M8 reminders (count and days are editable in Settings → Evaluations) |
| **Built** | H1 and the AD-sync half of U8 (section 8a) — the two lists are read with the permission PEA already has |
| **Not building** | B4 as a separate fix (covered by M3) · B9 · M1 M4 M5 · P1–P7 P9 · L1–L6 L8 · L7 attachments · U14 U15 |

Settled on 01-10-2026: U10 is built; M8 "copy the ratings" means a "copy from the previous evaluation" prefill when HR enters ratings in the app; H4 removes the work list and keeps the email log; L7 is notes only. What is still open is in section 9.

### Rule for every phase: comment out, never delete

Nothing is deleted outright, in any phase.

- A removed screen section, component, route, endpoint, query or function is commented out in place, with a one-line marker naming the point: `/* H2 (HR, 29-09-2026) — removed from the screen, kept for reference. … */`.
- Logic that is replaced stays as a commented block directly above the new code, with the point id.
- Imports, helpers and tests used only by commented-out code are commented out too, so lint and `npm test` stay clean.
- Files are not deleted or renamed.
- Plain wording edits are just edited: the "Commando" rename, the date format, the app name, label text.

Wherever this document says "remove", "delete" or "drop", read "comment out" under this rule.

JSX that has comments of its own cannot be wrapped in a block comment. Where that applies (Analytics), the removed markup sits at the foot of the same file as `//` lines, under a marker.

### Status on 01-10-2026

Nothing is committed. 69 tracked files are changed and 11 source files are new on the branch `harish-project-staging-v2`. One of the 69, `DEPLOYMENT.md` moving into `docs/`, was already in the working tree and is not part of this work. The day-by-day record is in [PEA-change-log.md](PEA-change-log.md).

| Phase | Points | Status |
|---|---|---|
| 1 | B6 B7 B8 · H2 H3 H4 H5 H6/U4 H7 H9 · U7 U12 | On disk. Backend tests pass, frontend builds. Awaiting review. |
| 2 | B1 B2 B3 M2 · U10 U11 | On disk. Tests pass. Awaiting review. |
| 3 | U1 U2 U3 P10 P11 · H8 | On disk, finished 01-10-2026. Tests pass, frontend builds. Awaiting review. |
| 4 | M3/U13 M7 M6 P8 B5/U9 M8 | On disk, finished 01-10-2026. Tests pass, frontend builds. Awaiting review. Every Phase 4 action needs the DDL; until it is applied the buttons are not offered and the API answers 503 with the reason. |
| 5 | U5 U6 U8 L7 | On disk, finished 01-10-2026. Tests pass, frontend builds. Awaiting review. The Notes card needs the DDL; until it is applied the card is not shown. |
| 6 | H1 · U8 (sync half) | On disk, finished 01-10-2026. Tests pass. Awaiting review. Decisions answered 02-10-2026 and built: three domains followed, contract staff and no-manager accounts left out, project leader from the Leaders list only. No new Microsoft 365 permission is needed. **07-10-2026:** the review stays (Microsoft 365 will not hold the joining date or experience); the inbox suggests the joining date (day after the account was created) and fresher/experienced (from the designation); admins and HR get an email and a bell when joiners arrive and a daily reminder while they wait. Interns stay in. |
| DDL | `2026-10-02-pea-review-round.sql` | Written for Phases 2, 3, 4 and 5 (`pea_employee_notes` added). Not applied anywhere. |

Last measured test results, after the archive of 07-10-2026: `npm test` in `backend/` passed 477 of 477, and the frontend builds. The day-by-day record is in `docs/PEA-change-log.md`. Nothing has been run in a browser or against a database with the new DDL applied — so Phase 4 in particular (links moving between people, reopening, HR entry) is untested end to end and needs the staging checklist in section 10. Phase 5's list filters, sorting and export were run against the staging data, reading only; Phase 6's directory read was run against the tenant, reading only.

A compact redesign of the manager's form was tried on 01-10-2026 and rejected. It was removed in full; the form is the original green-banner design with the Phase 3 additions.

### How the work proceeds from here

1. Phases 1 and 2 are reviewed first. Corrections are done before anything new.
2. Then one phase at a time: finish Phase 3 → stop and report → Phase 4 → stop and report → Phase 5 → stop and report.
3. Each report says what changed per point, what was commented out, and the test result.
4. No commits unless asked.

### Where the work on disk differs from the sections below

1. **U10 — PATCH.** The HR route drops `confirmation_status` and `employment_status` in `controllers/employee.controller.js`; the service still accepts them. `backend/scripts/e2e-scheduler.js` creates test records with those fields, so they were not commented out of the service.
2. **U11 — "decision due".** Counted from the end of the last evaluation's period, not from the 6/8-month setting in `confirmationDeadline.service.js`, so it follows the extension rule exactly.
3. **P11 — autosave.** At most every 15 seconds, not 3 seconds after each change, with its own rate limit.
4. **Excel export dates** are dd-MM-yyyy text. If an export were ever re-imported, the importer would read `05-03-2026` as 3 May. Nothing reads the export back today.
5. **Outside the source files:** `npm ci` in `backend/` and `frontend/` and `npx prisma generate`, to run the tests and the build.
6. **M7 — where "Send to someone else…" is.** On the evaluation page only, not also in the schedule row on the Commando page. The schedule row shows "with (name)" when an acting manager has the link, and Send/Resend there says the acting manager's link will stop working.
7. **M3 — a draft does not follow the link.** When a manager changes, or an evaluation goes to an acting manager, a draft saved by the previous holder is discarded. A half-written opinion belongs to whoever wrote it.
8. **P8 — no "Include handled" filter.** Once an outcome is recorded the evaluation leaves "Needs attention" for everyone. The outcome and its history are on the evaluation page and in the Commando's change history; the board has no separate way to list handled ones.
9. **HR entry — no decision in the dialog.** "Enter ratings" takes ratings, optional comments and remarks. The API accepts a decision on a final evaluation, but the screen does not offer one; a decision is recorded with "Record decision…" on the Commando page.
10. **HR entry and "Enter ratings" need the DDL.** Without the `entered_by` column an entry would be stored looking like the manager's own, so it is refused until the DDL is applied.
11. **B5 — "past due" includes today.** An evaluation due today counts, because the daily send would take it today.
12. **U5 — the manager filter has its own query.** Not the board's `managerOptions()`: the board lists managers of people still here, and the Commandos list also shows people who left.
13. **U5 / U6 — an unknown status or sort column is refused (400)**, not ignored.
14. **L7 — notes are read with their own call**, `GET /employees/:id/notes`, not inside the Commando record. They cannot be edited, are limited to 4,000 characters, and a deletion is written to the change history.
15. **U8 — who the picker offers.** Enabled, licensed accounts that are not system mailboxes. The directory read is reused for 10 minutes.
16. **Phase 6 — the lists are read per account, not per list.** The flow asks each list for its members (`/groups/{id}/members`); PEA's app registration is a different one, without a group permission, and gets a 403 on that call (checked 01-10-2026). No new permission is to be asked for, so PEA asks each enabled account which lists it is on (`/users/{id}/memberOf`), which `User.Read.All` allows. Same two sets of people; about 280 requests a scan. Both list ids start at the flow's values.
17. **Phase 6 — the decisions are settings, set as answered on 02-10-2026.** No-manager accounts: "leave out". Domains: `aapnainfotech.com`, `mera.work`, `karyakeeper.com`. The two lists: on. Each can be changed in Settings → New joiners without a deployment; clearing a list id switches its rule off.
18. **Phase 6 — the licence and system-mailbox rules are always on.** Confirmed 02-10-2026: unlicensed accounts are never offered.
19. **Phase 6 — what is taken off the inbox.** Contract staff, system mailboxes, excluded addresses and no-manager accounts ("leave out" is the setting). Unlicensed, disabled and off-domain accounts already waiting are left for HR.
20. **Phase 6 — the project leader comes from the Leaders list only** (decided 02-10-2026). Section 8a said the map learned from the roster stays as the fallback; it does not. When nobody on the Leaders list is at or above the manager, no project leader is suggested and HR chooses. "Refresh project-leader suggestions" on New joiners and "Rebuild map" on Upload sheet are removed from the screens.
21. **Phase 6 — the list of domains has its own setting key**, `azure_email_domains`. Section 8a said the one-domain setting becomes a list. Staging stores the one-domain row and the build running there reads it as a single domain; a list saved into it would match no account. The old row is left untouched and unread.
22. **Phase 6 — the review stays, and says when it is needed** (07-10-2026). Microsoft 365 will not hold the date of joining or the years of experience, so "add joiners automatically" (05-10-2026) is withdrawn. The inbox suggests both, and nothing is final until HR or an admin confirms: the joining date is the day after the account was created; fresher or experienced comes from the job title, by word lists in Settings → New joiners ("associate" counts as experienced). A new email, `joiners_waiting`, and the bell tell admins and HR when a scan finds new joiners, and once a day while anyone waits. Its email type is added to `2026-10-02-pea-review-round.sql`. Interns are not filtered out; only contract staff are.
23. **Archive** (07-10-2026, asked for by Harish). Commandos confirmed, not confirmed or marked as left are archived the morning after the decision or exit (a setting, 0 days to start), or by hand; HR can restore them. Archived people are a read-only record, out of the Commandos list, the board, the Dashboard, Trends, the manager's team link and the Microsoft 365 checks. Four columns on `pea_employees`, added to `2026-10-02-pea-review-round.sql`. Details in `docs/PEA-change-log.md` under 07-10-2026.
24. **New Joiner Inbox table** (07-10-2026): one line per cell at fixed widths; "Account created" and "To fix" moved into tooltips.

---

## 2. Order of work

| Phase | What | Needs DDL | Size |
|---|---|---|---|
| 1 | HR's 29-09 email and the quick fixes: B6 B7 B8, H2 H3 H4 H5 H6/U4 H7 H9, U7 U12 | No | M |
| 2 | Probation rule: B1 B2 B3 M2, U10 and U11 | Yes (decision and exit columns) | M |
| 3 | Manager form and emails: U1 U2 U3, P10, P11, H8 | Yes (draft columns) | M |
| 4 | Who answered, and HR actions on one evaluation: M3/U13, M7, M6, P8, B5/U9 | Yes | L |
| 5 | Employees list and page: U5 U6, U8 picker, L7 | Yes (notes) | M |
| 6 | H1 and AD sync, from the MRA Reconcile flow (section 8a) | No (settings rows only) | M — built; the four decisions answered |

Phase 2 is the only one that changes what a manager is asked and when, so it gets the most tests. Phase 1 ships first because it is what HR asked for by email and none of it touches the database.

---

## 3. Database changes

One additive file, `backend/prisma/ddl/2026-10-02-pea-review-round.sql`, in the style of `2026-09-23-pea-board-redesign.sql`: wrong-database guard, one transaction, `IF NOT EXISTS`, grants to `peauser`, verification query. Safe to re-run. Code keeps the existing pattern — raw SQL plus a probe in `utils/schemaCapabilities.js` — so the build can deploy before the file is applied.

| Object | For | Notes |
|---|---|---|
| `pea_evaluation_cycles.sent_to_name`, `sent_to_email` | M3 M7 | Who the live link was issued to. Backfill open cycles from the employee's current manager. |
| `pea_evaluation_cycles.submitted_by_name` | M3 U13 | Backfill from `rm_name` where `submitted_by_email` matches `rm_email`. |
| `pea_evaluation_cycles.delegated` BOOLEAN | M7 | True while the link is with an acting manager. |
| `pea_evaluation_cycles.entered_by` | B5 | HR username when HR typed the ratings in. NULL otherwise. |
| `pea_evaluation_cycles.draft` JSONB, `draft_saved_at` | P11 M6 | Unsubmitted answers. |
| `pea_evaluation_revisions` | M6 | `cycle_id`, `snapshot` JSONB, `reason`, `reopened_by`, `reopened_at`. |
| `pea_evaluation_followups` | P8 | `cycle_id`, `outcome` (CHECK), `note`, `recorded_by`, `recorded_at`. |
| `pea_employee_notes` | L7 | `employee_id`, `body`, `created_by`, `created_at`. |
| `pea_employees.decision_on`, `decision_reason`, `decision_by`, `left_on`, `left_reason` | U10 | Filled by "Record decision" and "Mark as left". |
| `pea_email_log_type_chk` | M6 | Add `evaluation_reopened`. |

No change to the `seq_no BETWEEN 1 AND 8` check: the new extension cap keeps freshers at 8 and experienced at 5.

---

## 4. Phase 1 — HR's email and quick fixes

### B6 · Employee view always says "0 of N"
`frontend/src/pages/SelfView.jsx:63` — count `'Submitted'`, which is what `selfView.service.js` sends.

### B7 · "Close This Window" does nothing
`backend/src/views/evaluationForm.js:642` and `:759`.
- Remove the inline `onclick` (the CSP in `app.js:41` only allows nonce'd scripts). Give the button an id and bind it in a `<script nonce>` block.
- `renderThanks` and `renderError` take a `nonce`; `evaluation.controller.js` passes `res.locals.cspNonce` at all four call sites.
- On click: `window.close()`, then after 300 ms, if the page is still there, replace the hint with "This tab could not be closed automatically. Please close it yourself."
- Label becomes "Close this tab".

### B8 · Form says the employee reads the comments
`evaluationForm.js:484`, `:396`, `:398`, `:435`.
- `getFormData()` adds `employeeSeesComments` (true only when `employee_self_view` is `full`).
- When false: "HR reads these." and neutral placeholders. When true: today's wording.

### H2 · Remove five Analytics sections
`frontend/src/pages/Analytics.jsx:173–369` — delete the whole "Overall trends" `Collapse` and the now-unused imports (recharts, `Row`, `Col`, `Table`, `Collapse`, `Empty`, `usePalette`, `OUTCOME_COLOUR`, `chartTooltip`).
`backend/src/services/analytics.service.js` — drop `trend`, `outcomes`, `parameters`, `distribution`, `managers` and their queries; keep `summary`. The four figures and `ResourceTrends` stay. Update `resourceTrends.test.js` if it asserts on the removed keys.

### H3 · Duplicate figures on the board
`frontend/src/pages/EvaluationBoard.jsx:189–204` — remove the Submitted, Waiting for manager and Need attention figures. Keep Average rating with its trend line (it is not on a chip). `stats.submitted/waitingForManager/needAttention` leave `evaluationBoard.service.js` `summarise()`.

### H4 · "Work list & emails" — recommendation: remove the list, keep the email log
What the work list has that the board does not:
- Group by manager — the board's manager filter does the same job.
- "Decisions due" and "Due in 14 days" tabs — the Dashboard already shows both.
- **Emails sent** — the only screen that answers "did the manager get the email?". Worth keeping.

So (confirmed 01-10-2026):
- `Evaluations.jsx` stays as a file. The work-list half is commented out and the page renders only `EmailsSent`, at a new route `/evaluations/emails`. `/evaluations/worklist` redirects there.
- Board link (`EvaluationBoard.jsx:281`) becomes "Email log".
- Backend: comment out `listEvaluations` and `GET /api/evaluations`. Keep `getCounts` (Overview uses it, `Overview.jsx:161`), `remindNow`, `listEmails`. Comment out the matching cases in `evaluationList.test.js`.

### H5 · Remove "All seven ratings"
`frontend/src/pages/EvaluationProfile.jsx` — delete `RatingsPanel` (`:158–177`), its use at `:602`, and `Dots`/`jumpTo` if nothing else uses them.

### H6 / U4 · One date format: dd-MM-yyyy
Display only. APIs and query strings stay `YYYY-MM-DD`.

| Where | Change |
|---|---|
| `frontend/src/formatDate.js` | `formatDate` → `16-08-2026`; `formatDateTime` → `16-08-2026 14:05`. Rewrite the header comment. |
| `frontend/src/evaluationDisplay.js` | `shortDate` → full `dd-MM-yyyy` (a bare `22-08` reads like a range); `shortDateTime` follows. Check card and rail widths in `board.css`. |
| Date pickers | `DD-MMM-YYYY` / `DD MMM YYYY` → `DD-MM-YYYY` in Employees, EmployeeDetail, EvaluationBoard, EmailLog, NewJoiners, Analytics. |
| Raw dates | `Employees.jsx:79`, `:106`, `:229` · `EmployeeDetail.jsx:624`, `:759` · `SelfView.jsx:72`, `:105`, `:157` (and period text built in `selfView.service.js:82`) · ManagerPortal, AdminDashboard, Overview, NewJoiners — all through `formatDate`. |
| `backend/src/utils/dateUtils.js` | `formatDisplay` → `dd-MM-yyyy`. Covers the manager form and every email. |
| Backend strings that print ISO | `evaluation.service.js:71` (already-submitted message), `emailTemplate.service.js` `overdue_table` and `SAMPLE_VARS`, `confirmationDeadline.service.js:158`, `syncAlert.service.js`, `needsAction.service.js`, `evaluationReport.service.js`, `export.service.js`. |

Tests that assert `02-Jan-2023` style strings need updating (`emailTemplate.test.js`, `evaluationReport.test.js`, `selfView.test.js`).

### H7 · Rename to "AAPNA Probation Period Evaluation Platform"
`frontend/index.html:7` · `App.jsx:154` (sidebar: "AAPNA" / "Probation Period Evaluation Platform") · `AuthShell.jsx:13` · `SelfView.jsx:47` · `ManagerPortal.jsx` · `Overview.jsx` · `EvaluationProfile.jsx:244` (print header) · `accountEmail.service.js` (6 places) · `emailLayout.service.js` · `evaluationForm.js` (headers, footer, titles — 7 places) · `notification.service.js:205` (fallback subject) · `export.service.js`.
The "PEA" mark stays.

### H9 · "Employees" → "Commandos"
Visible text only: screens, the manager form, emails, Excel headers, bell notifications.
- Not changed: routes (`/employees`), API paths, tables, module keys, `{{employee_name}}` placeholder keys (saved templates keep working), variable names.
- Written "Commando" / "Commandos", capitalised, as a term.
- About 140 strings across 23 frontend files, plus `emailTemplate.service.js`, `evaluationForm.js`, `inAppNotification` titles in `employee.service.js`, `evaluation.service.js`, `joinerIntake.service.js`, `confirmationDeadline.service.js`, and error messages HR sees.
- Done last in this phase so it also covers the strings H3–H7 touch. Every later phase writes "Commando" from the start.
- Templates HR has already edited keep whatever HR typed.

### U7 · Search fires on every keystroke
`Employees.jsx:146` — same 350 ms settle the board uses (`EvaluationBoard.jsx:111–119`).

### U12 · Readable change history
`EmployeeDetail.jsx:610–631`.
- Label map: `rm_email` → "Reporting manager email", `halt_process` → "Evaluations on hold" (Yes/No), `confirmation_status` → "Probation decision", `employment_status`, `doj` (formatted), `is_experienced` → "Fresher or experienced", `locked_fields`, and so on.
- Timestamp through `formatDateTime`.
- Show 20, then "Show all (N)". `employee.service.js:418` raises `take` from 50 to 500.

---

## 5. Phase 2 — Probation rule (B1 B2 B3 M2 U11)

### The rule

| | Regular evaluations | Extension evaluations | Longest probation |
|---|---|---|---|
| Fresher | 6, every 30 days | 7th and 8th | 240 days |
| Experienced | 3, every 60 days | 4th and 5th | 240 days |

- At most **two** extension evaluations per person, ever.
- Each extension evaluation covers the 30 days after the previous evaluation's period end. Not a fixed offset from the joining date.
- What the final evaluation offers depends on what is left:

| Extension evaluations already scheduled | Options on the form |
|---|---|
| 0 | Confirm · Do not confirm · Extend 1 month · Extend 2 months |
| 1 | Confirm · Do not confirm · Extend 1 month |
| 2 | Confirm · Do not confirm |

### `backend/src/services/cycleGenerator.service.js`
- Replace `EXTENSION_DAYS` (`:42`) with `EXTENSION_MONTHS = { 'Extend for 1 month': 1, 'Extend for 2 months': 2 }`, `EXTENSION_INTERVAL_DAYS = 30`, `MAX_EXTENSION_CYCLES = 2`.
- `buildExtensionSchedule(lastCycle, confirmationStatus)` — anchor on `lastCycle.period_to` (fall back to `due_date`). Cycle *i* runs anchor + 30·*i* → anchor + 30·(*i*+1). Stays a pure function.
- New `extensionsLeft(cycles)` = 2 − count of `is_extension`.
- `generateExtensionCycles` (`:151`) — if the request needs more than is left, throw `AppError(409)` instead of quietly creating nothing. Drop the `seq_no <= 8` filter.
- Header comment rewritten to the table above.

### `backend/src/services/evaluation.service.js`
- New `decisionOptions(cycle)` → the allowed subset of `CONFIRMATION_OPTIONS`.
- `getFormData()` returns `confirmationOptions`; `renderForm` uses it in place of the global list (`evaluationForm.js:421`); the JSON route returns the same list (`evaluation.controller.js:68`).
- `submit()` rejects a decision that is not allowed, as a form problem on `confirmation_status`.

### `backend/src/services/employee.service.js` — B3 and U10
- `recordDecision(id, { decision, reason, date }, actor)` → `POST /employees/:id/decision`. Same options table as the manager form; reason required unless Confirmed. "Extend…" calls `generateExtensionCycles` in the same transaction (this is the B3 fix). Confirmed / Not Confirmed closes open evaluations.
- `markLeft(id, { left_on, reason }, actor)` → `POST /employees/:id/mark-left`. Closes open evaluations and expires their links — the logic `joinerIntake.service.js` `confirmLeaver` already has, lifted so both use it. `markActive` reverses the status only.
- `PATCH /employees/:id` stops accepting `confirmation_status` and `employment_status` — the controller drops them; the service still accepts them for non-HR callers. The two fields in the Edit modal (`EmployeeDetail.jsx:684–695`) are commented out. The hero gets "Record decision…"; "Mark as left…" / "Mark as active again" sit under More.
- Reason and date go to the new `pea_employees` columns when the DDL is applied, and to the change history either way.
- `getEmployee()` returns `probation: { endsOn, extensionsUsed, extensionsLeft, decisionOptions }`; the dialog offers only what is allowed.

### U11 · "Probation ends" on the employee page
- `endsOn` = latest `period_to` among the person's evaluations (moves when an extension is granted).
- Hero line in `EmployeeDetail.jsx:301`: "Probation ends 28-12-2026". Once that date is past with no final decision: "Decision due — ended N days ago" (amber up to 7 days, red after).

### Other
- `settings.service.js:172–173` — the "not in effect" text still says "DOJ + 210 days". Reword.
- `ratingScale.js` help text for the extend options is still correct.

### Tests (`cycleGenerator.test.js`, `phase2Features.test.js`)
1. Fresher, extend 2 at evaluation 6 → 7 and 8 at 210 and 240 days.
2. Fresher, extend 1 at 6, extend 1 again at 7 → 8 covers 210–240, not 180–210 (B1).
3. Extend at evaluation 8 → refused; the form does not offer it (B2).
4. Experienced, extend 2 at evaluation 3 → 4 and 5 at 210 and 240 days.
5. Extend 2 when one is already used → refused.
6. HR sets "Extend for 1 month" in Edit → one evaluation created (B3).
7. Weekend: due date shifts, period does not, next anchor is unaffected.

One edge to know about: if a manager answers the final evaluation very late, the extension's computed date can already be past. It then goes out on the next morning's run. That is correct — the period it covers has ended — and needs no special case.

---

## 6. Phase 3 — Manager form and emails

All in `backend/src/views/evaluationForm.js` unless noted. The form stays server-rendered and keeps working with JavaScript off.

### U1 · "4 of 7 answered"
A sticky bar above the questions. A question counts once it has both a rating and a comment. Server renders the starting count; the nonce'd script keeps it live.

### U2 · Missing rating is linked and highlighted
- `scoreProblems()` (`evaluation.service.js:248`) — rating problems become `{ field: 'rating_<key>', label, text }`.
- `anchorFor()` maps `rating_…` to `#q_<key>`; each `.q` gets that id and an `invalid` style with "Choose a rating".
- `submitterIdentity.test.js` and any test matching `field === 'rating'` updated.

### U3 · Rating options grouped for screen readers
Each option set becomes a `<fieldset>` with the question as `<legend>`; `aria-invalid` and `aria-describedby` point at the error line.

### P10 · Previous evaluation on the form
- `getFormData()` adds `previous`: the latest submitted evaluation before this one that has per-question scores — number, date, average, remarks, and scores by key. Imported free-text history is skipped.
- Under each question: a collapsed "Last time (Evaluation 2): 3 — Satisfied" with that comment. Above the questions: last average and overall remarks.

### P11 · Save as draft — proposal: on the server
A browser-only draft is lost when the manager opens the email on a phone and finishes on a laptop, which is the common case. So:
- `POST /api/evaluation/:token/draft` (`evaluation.routes.js`, same rate limiter). Stores the parsed body in `draft`. No required-field checks; ratings range-checked; comments capped at 5,000 characters.
- A "Save draft" button with `formaction` and `formnovalidate` — works with JavaScript off, re-renders with "Draft saved 14:05".
- With JavaScript: autosave a few seconds after the last change (at most every 15 seconds) and when the tab is hidden. The route has its own rate limit so drafts do not use up the form's.
- `getForm` refills from the draft. `submit()` clears it. A manager change (M3) clears it too.
- Board: an opened evaluation with a draft shows "draft saved 01-10-2026" on its card.
- Until the DDL is applied the button is hidden (`hasColumn('pea_evaluation_cycles','draft')`).

### H8 · Probation in every email
`backend/src/services/emailTemplate.service.js`.
- New placeholders: `{{evaluation_total}}`, `{{probation_start}}`, `{{probation_end}}`, and a block `{{probation_line}}` — "Probation period: 01-07-2026 to 28-12-2026 · evaluation 2 of 6".
- `queueEmail()` (`notification.service.js:166`) loads the person's evaluations once and passes start, end and total in the context; `buildVars()` stays synchronous.
- Default wording: "performance evaluation" → "probation evaluation" in all nine templates. Subjects for the request and reminder become "Probation Evaluation 2 of 6 - Name". `{{probation_line}}` added to request, reminder, submitted, extended and shared-report bodies.
- **Templates HR has edited do not pick up new defaults.** The Email Templates screen already marks them (`overridden`). Before release, list which are edited on production; HR either resets them or adds `{{probation_line}}`.
- `emailTemplate.test.js` updated.

---

## 7. Phase 4 — Who answered, and HR actions on one evaluation

### Shared groundwork
Lift the body of `sendEvaluationNow` (`admin.controller.js:53–151`) into a service function, `issueLink(cycle, { recipient?, delegated?, template? })`: new token, expiry, reset reminders, set `sent_to_*`, send, and roll back if nothing left the system. Four callers: manual send, manager change, delegate, reopen.

Likewise lift the write half of `submit()` into `recordSubmission(cycle, rows, extras, tx)` so HR entry (B5) and a corrected resubmission (M6) share it.

### M3 / B4 / U13 · Change of manager
- **Sending:** the sweep (`evaluationScheduler.js:184`) and `issueLink` stamp `sent_to_name/email`.
- **Recipients:** `resolveRecipients()` (`notification.service.js:95`) sends requests and reminders to `cycle.sent_to_email`, falling back to the employee's manager. `buildVars` greets `sent_to_name`.
- **Submitting:** `submit()` (`evaluation.service.js:287`) records `sent_to_*` as `submitted_by_email/name` — not the current manager.
- **On change:** `updateEmployee()` — when `rm_email` changes, every evaluation in "sent" or "opened" gets a new link issued to the new manager. The old link dies with the old token. Drafts are cleared. If a send fails, that evaluation returns to pending and the morning run retries it.
- **Edit modal:** when the manager changed and links are open — "2 open evaluation links will be cancelled and sent to the new manager."
- **Display:** `shape()` (`evaluationBoard.service.js:345`) adds `answeredBy` (snapshot name → email → current manager for old rows). Used at `EvaluationProfile.jsx:258`, `:628`, `:644`, `evaluationDisplay.js:141`, and the board cards. Past evaluations show who answered; open ones show who has the link.
- Acknowledgement email uses the snapshot name (`evaluation.service.js:417`).

### M7 · Send to an acting manager
- `POST /api/evaluations/:id/delegate { name, email, note }` — hr tier. Evaluation must be open; same hold checks as a manual send. Calls `issueLink` with `delegated: true`; the real manager is added to CC.
- Reminders follow the delegate. Their submission is recorded under their name.
- One evaluation only. The next one goes to the reporting manager again. For a long absence, change the manager instead.
- A plain Resend returns it to the reporting manager.
- Change-history row on the employee.
- UI: "Send to someone else…" on the evaluation page's "Nothing back yet" card and in the schedule row on the employee page.

### M6 · Reopen a submitted evaluation
- `POST /api/evaluations/:id/reopen { reason }` — hr tier, reason required.
- Allowed only when: it is the person's most recent submitted evaluation, it has per-question scores (not imported free text), the person is active, and no later evaluation has been sent.
- What happens, in one transaction:
  1. The submitted answers are copied to `pea_evaluation_revisions` with the reason and who reopened it.
  2. The answers move into `draft`; score rows and the average are cleared; read receipts for it are removed.
  3. If it carried a decision: the employee's decision returns to what it was before. Extension evaluations it created are deleted if untouched; if one has already gone out, reopening is refused with that explanation.
  4. `issueLink` with the new `evaluation_reopened` template — "HR has reopened this so you can correct it. Reason: … Your earlier answers are filled in."
- The manager's form opens prefilled (P11 mechanism). Resubmitting runs the normal path.
- UI: "Reopen…" in the evaluation page actions; a "Corrected on 02-10-2026 — see earlier version" panel listing revisions; a change-history row on the employee.
- Depends on P11's columns.

### P8 · What HR did about flagged feedback
- `POST /api/evaluations/:id/follow-up { outcome, note }`. Outcomes: Spoke to the manager · Spoke to the Commando · Improvement plan started · No action needed · Other.
- `shape()` adds `followUp`; the evaluation page's "Needs attention" card gets "Record what was done" and then shows outcome, who and when.
- Once an outcome is recorded the evaluation leaves the "Needs attention" count and the Dashboard's "Read feedback" list **for everyone** (read marks stay per person). It still carries a muted flag, and the attention filter gets "Include handled".
- `ATTENTION_SQL` consumers in `summarise()` and `getUnreadFeedback()` exclude handled rows when the table exists.

### B5 / U9 · Late additions and long holds
- `POST /employees/preview-schedule` marks each row `pastDue`.
- When any are past due, the Add modal (`Employees.jsx`) and the New-joiner accept form ask:

  | Choice | Result |
  |---|---|
  | Ask the manager for the latest one only *(default)* | Older ones closed as history; one form goes out. |
  | Keep them blank | All past-due closed. Nothing sent until the next due date. |
  | I will enter the ratings myself | All past-due closed; each gets an "Enter ratings" button. |
  | Ask the manager for all of them | Today's behaviour. |

- API: `past_due_action: 'send_latest' | 'close' | 'send_all'` on `POST /employees`, joiner accept, and `POST /employees/:id/halt` when resuming. Applied inside the create transaction; one change-history row says how many were closed.
- Resuming from hold with overdue evaluations shows the same question.
- **Enter ratings (HR):** `POST /api/evaluations/:id/record` — hr tier. Same seven ratings; comments optional (history often has none); `entered_by` set; no acknowledgement email. The evaluation page shows "Entered by HR (name) on behalf of (manager)". A decision is accepted on a final evaluation under the same phase-2 rules.
- **M8 — copy from the previous evaluation:** the HR entry screen has "Copy from evaluation N", which fills the ratings and comments from the previous submitted evaluation as a starting point. Only in the app, never on the manager's form.
- The Excel import keeps its own rule (`closeStaleCycles`).

---

## 8. Phase 5 — Employees list and page

### U5 · More filters
`employee.service.js` `listEmployees()` (`:330`): one `state` filter — In probation, Extended, Confirmed, Not Confirmed, Paused, Left, Held (may have left) — plus `rm`. "Held" is flagged and not dismissed since, the same test `evaluationScheduler.js:112` uses. Manager options from a new `GET /employees/managers` (reuse `managerOptions()` from the board service).

### U6 · Sortable columns and export
- `sort` and `order`, whitelisted: name, joining date, manager, status. The table uses server sorting, since the list is paged.
- "Next due" sort needs a subquery; leave it out unless HR asks.
- `GET /employees/export` with the same filters, built on `export.service.js`.

### U8 · Pick manager and project leader from the directory
- `GET /api/directory/people?q=` — hr tier. Serves from `entra.listAccounts()` cached in memory for 10 minutes (about 260 accounts), filtered by name or email.
- `PersonPicker` component: search-as-you-type, fills name and email together. Still accepts typed values, so a Microsoft outage never blocks HR.
- Choosing a manager prefills the project leader via `derivePl()`; an ambiguous mapping shows its note and leaves the field empty.
- Used in Add, Edit, New-joiner accept and the M7 dialog.
- The AD-sync fix itself is phase 6 (section 8a): the project leader then comes from the Leaders list, with `derivePl()` as the fallback.

### L7 · HR notes
- `GET/POST/DELETE /employees/:id/notes`; a "Notes" card on the employee page. Visible to HR users only — never on the self-view or manager portal.
- Attachments are not in this round: they wait for a decision on where files are stored and backed up.

---

## 8a. Phase 6 — AD sync, from the MRA Reconcile flow (H1, U8)

Source: `MRAReconcile-v3-….json`, received 01-10-2026. Built on 01-10-2026; what is on disk, and where it differs from this section, is in [PEA-change-log.md](PEA-change-log.md) under "Phase 6" and in the list in section 1 (items 16–19). The code is in `services/directory.service.js` (new), `entraDirectory.service.js`, `joinerIntake.service.js` and `settings.service.js`.

### What the flow does

| Step | Rule in the flow |
|---|---|
| Read people | One Graph call: enabled accounts, with their licences and their manager (`$expand=manager`). |
| Read two groups | Members of the **Contractor** distribution list and the **Leaders** distribution list. |
| Who counts ("rateable") | Account enabled · has a mail address · mail domain is on the allowed list (`aapnainfotech.com`, `mera.work`, `karyakeeper.com`) · has at least one licence · is not a system mailbox (hosting@, helpdesk@, legaldepartment@, it_notification@) · is not on the excluded-emails list · **is not in the Contractor list** · has a manager in Entra. |
| No manager in Entra | Reported in the summary email; not created. |
| Leader for a manager | Walk up the manager chain until someone in the Leaders list is reached. Six levels at most. |
| Safety | Stops and changes nothing if any read comes back empty or incomplete. Deactivates nobody when more than 10% would be deactivated, or in report-only mode. |

So the flow's answer to H1 is: **contract staff are the members of the Contractor distribution list; everyone else who passes the checks is an intern or permanent.** It does not tell an intern from a permanent, and PEA does not need it to.

### What changes in PEA

| Point | What changes for the person using it | Files |
|---|---|---|
| H1 | The New Joiner Inbox lists only interns and permanent staff. Contract staff, unlicensed accounts, system mailboxes and excluded addresses never appear. A contractor already waiting in the inbox is taken off it with the reason "Contract staff". | `backend/src/services/entraDirectory.service.js` (group members, `$expand=manager`), `services/joinerIntake.service.js` (the "rateable" rule as one pure, tested function) |
| H1 | Accounts on `mera.work` and `karyakeeper.com` are picked up, not only `aapnainfotech.com`. | `services/settings.service.js` (the one-domain setting becomes a list) |
| U8 | The project leader is filled from the directory: the first person up the manager's chain who is in the Leaders list. The map learned from the roster stays as the fallback when the chain finds nobody. | `services/joinerIntake.service.js`, `services/rmPlMap.service.js` (kept, used second) |
| U8 | The manager comes with the account in one read, in place of one request per person. | `entraDirectory.service.js` (`fetchManagers` commented out, not deleted) |
| Safety | If the Contractor or Leaders list comes back empty, or a read is cut short, the check stops, changes nothing, and HR gets the existing "Microsoft 365 check" alert saying why. An empty Contractor list must never let contractors through. | `joinerIntake.service.js`, `services/syncAlert.service.js` |
| Settings | Allowed domains, the two group ids, excluded emails and system mailboxes are settings under New joiners, with the flow's values as defaults. | `settings.service.js`, no DDL (rows in `pea_settings`) |
| Diagnostics | The header warning also checks that PEA can read group members. | `entraDirectory.service.js` (`verifyDirectoryAccess`) |

Unchanged: the leaver check still reads disabled accounts (the flow reads enabled ones only; PEA needs both). Nobody is added without HR accepting them.

### What the flow does not solve

- **Joining date and fresher / experienced.** Neither is in Entra or in the flow. HR still confirms those two for each joiner, so H1's "no manual checking" becomes "no sorting out contractors by hand", not "no confirmation at all".
- **Permission.** Reading a group's members needs `GroupMember.Read.All`. The flow uses its own registration, which has a group permission; PEA's does not. Settled 01-10-2026: none is to be asked for, and none is needed — PEA reads which lists each account is on instead, with `User.Read.All`.

### The four decisions — all answered

Each is a setting under Settings → New joiners, set as answered. Changing one later means changing a setting, not changing code.

1. **People with no manager in Entra.** Answered 02-10-2026: **leave out**, as the flow does. Setting: "New accounts with no manager". One already waiting is taken off the inbox, and comes back once Microsoft 365 has a manager for them.
2. **Domains.** Answered 02-10-2026: **follow all three** — `aapnainfotech.com`, `mera.work` (28 accounts), `karyakeeper.com` (5 accounts). Setting: "Joiner email domains".
3. **Permission.** Settled 01-10-2026: no new permission. PEA's registration has `User.Read.All` only, and the lists are read through it (`/users/{id}/memberOf`). Both list rules are on.
4. **Project leader.** Answered 02-10-2026: **the Leaders list only**. The first person on the Leaders list at or above the manager is suggested; the map learned from the roster is no longer used. HR still confirms the project leader for each joiner. Clearing the Leaders list id means no suggestion at all.

The two list ids are the flow's: Contractor list `d598b53f-9221-4c67-a1b4-fdd1ba9162d9`, Leaders list `a7faa0e9-353b-42a5-83ed-859f38abd0cd`. Clearing one in Settings switches its rule off.

### About the flow file itself

- It contains the app registration's **client secret in plain text**, in three places. It sits in the repository folder and git does not ignore it. It should not be committed. If it has been shared or pushed anywhere, the secret should be rotated.
- One defect seen while reading, in case it matters to the flow: "Condition Manager Exist" compares the manager's list id with `true`, so it always takes the Update branch. A manager who is not in the SharePoint list yet would hit Update with an empty id instead of Create. The leader and member conditions compare with an empty string and are right.

---

## 9. Still needed from you

1. **H1 / U8 — the four decisions in section 8a.** All answered and built (02-10-2026). Nothing further is needed here.
2. **H8 — edited templates.** Answered 02-10-2026: none on production. On staging four are edited (evaluation request, reminder, acknowledgement, manager's team link); each needs a reset or a manual `{{probation_line}}` before H8 can be seen there.
3. **M8 — reminders.** Count (0–2) and days are already editable in Settings. If HR needs more than two, the database check has to be lifted — say so.

Assumptions I have made, say if any is wrong:
- dd-MM-yyyy applies to emails and the manager form too, not only the HR screens.
- "Commandos" applies to the manager form and emails too.
- Reopen (M6), delegate (M7) and HR entry (B5) are available to the HR role, not only admins.
- B5 default is "ask the manager for the latest one only".

---

## 10. Release steps for each phase

1. `npm test` in `backend/` (node test runner).
2. Apply the DDL on staging (phases 3–5), check its verification query.
3. Staging run with the email redirect on: one fresher and one experienced record walked through final evaluation → extend → extend → decide; a manager change with a link open; a reopen; a late addition.
   Phase 4 in full: change a manager with one link sent and one opened (old links show "invalid", new ones arrive, drafts gone); send one to an acting manager, let a reminder go out, submit it, then check who it is recorded under; Resend one that is with an acting manager; reopen the latest submitted evaluation with and without a decision on it, and resubmit; record a follow-up and check it leaves "Needs attention" for a second HR user; add someone who joined four months ago under each of the four choices; hold someone past a due date and resume; "Enter ratings" on a closed evaluation, with "Copy from evaluation N".
   Phase 5: each Status filter and the manager filter, alone and together; sort by each of the four headings, both ways, and turn a page; Export with a filter on and check the file matches the list; pick a manager by name in Add, Edit, New-joiner confirm and "Send to someone else…" and check the email and project leader fill in; add a note, delete it as its author, try to delete another HR user's note as a non-admin, and check the change history; print the Commando page and check the notes are not on it.
   Phase 6: "Test run" on New joiners and read "left out" — a known contractor created in the last 45 days should be counted there, and a known joiner's project leader should come from the Leaders list; "Scan now" and check a contractor already waiting leaves the inbox with the reason; set the Contractor id to a wrong one and confirm the check stops and says nobody is on the list; clear it and confirm the rule is off and the screen says so; put it back.
4. Phase 3 only: check edited templates (decision 7).
5. Production: DDL first, then the build. Every new feature degrades to today's behaviour until its DDL is present.
