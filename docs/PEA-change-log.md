# PEA — change log

What has been changed in PEA for the review round of 29-09-2026, and how far each point has got. Newest day first.

- Requirements and answers: [PEA-review-points.md](PEA-review-points.md)
- How each point is built: [PEA-implementation-plan.md](PEA-implementation-plan.md)
- Branch: `harish-project-staging-v2` · committed by Harish on 05-10-2026 as `d23df51` ("all feedback implemented except the intern list addition"); the work of 05-10 to 07-10-2026 is not committed yet. **That commit contains the flow export with its client secret** — see "Pending", section 5. Not pushed, as far as this clone knows.

## How to keep this log

- One section per working day, newest first, dated dd-MM-yyyy.
- Each entry names the review point (B1, H4, …), what the person using PEA now sees, and what was commented out.
- Update the progress tables below in the same edit.
- Update "Pending" in the same edit: tick what is done, add what is new, and move a decision out of the table once it is answered.
- Status words, used the same way everywhere:

| Status | Meaning |
|---|---|
| Not started | No code written. |
| On disk | Written, tests pass, frontend builds. Not yet reviewed. |
| Reviewed | Read and accepted by Harish. |
| On staging | DDL applied and the staging checklist walked through. |
| Released | On production. |
| Waiting | Cannot move until a decision or input arrives. |
| Not building | Answered "later" or "won't do" in the review. |

---

## Progress

### By phase

| Phase | Points | Status | Needs the DDL |
|---|---|---|---|
| 1 — HR's email and quick fixes | B6 B7 B8 · H2 H3 H4 H5 H6/U4 H7 H9 · U7 U12 | On disk | No |
| 2 — Probation rule | B1 B2 B3 M2 · U10 U11 | On disk | Only to store the decision reason and date |
| 3 — Manager form and emails | U1 U2 U3 P10 P11 · H8 | On disk | P11 (drafts) only |
| 4 — Who answered, and HR actions on one evaluation | M3/U13 M7 M6 P8 B5/U9 M8 | On disk | Yes, all of it |
| 5 — Commandos list and page | U5 U6 U8 L7 | On disk | L7 (notes) only |
| 6 — AD sync from the MRA Reconcile flow | H1 · U8 (sync half) | On disk — all rules on as decided 02-10-2026: three domains, contract staff and no-manager accounts left out, project leader from the Leaders list only | No (settings only) |
| Top bar and Evaluations board tidy-up | — (asked for 01-10-2026) | On disk | No |
| Archive of Commandos whose probation is over | — (asked for 07-10-2026) | On disk | Yes |
| New Joiner Inbox table, one line per cell | — (asked for 07-10-2026) | On disk | No |
| Database — `2026-10-02-pea-review-round.sql` | Phases 2, 3, 4, 5, the review email, the archive | Written, **not applied anywhere** | — |

Overall: 6 of 6 phases on disk · 0 reviewed · 0 on staging · 0 released.

Of the 60 review points: 39 on disk · 0 not started · 0 waiting · 21 not building.

### By point

| Point | What it is | Phase | Status |
|---|---|---|---|
| B1 | Second extension repeated the same period | 2 | On disk |
| B2 | "Extend" offered past the 8-month limit | 2 | On disk |
| B3 | "Extend" chosen in Edit scheduled nothing | 2 | On disk |
| B4 | Submission credited to the wrong manager | 4 | On disk (covered by M3) |
| B5 | Late addition sends every past-due form at once | 4 | On disk |
| B6 | Commando view always said "0 of N" | 1 | On disk |
| B7 | "Close This Window" did nothing | 1 | On disk |
| B8 | Form said the Commando reads the comments | 1 | On disk |
| B9 | Manager portal shows "Extend…" in red | — | Not building |
| M1 | HR approval before a decision takes effect | — | Not building |
| M2 | Extension limit (two evaluations at most) | 2 | On disk |
| M3 | Change of manager with a link open | 4 | On disk |
| M4 | Leave during probation | — | Not building |
| M5 | Skip or close one evaluation | — | Not building |
| M6 | Reopen a submitted evaluation | 4 | On disk |
| M7 | Send to an acting manager | 4 | On disk |
| M8 | Copy ratings from the previous evaluation (HR entry) | 4 | On disk |
| P1 | Letters | — | Not building |
| P2 | Emails to the employee | — | Not building |
| P3 | "Feedback discussed with the employee on ___" field | — | Not building |
| P4 | Employee acknowledgement | — | Not building |
| P5 | Employee self-assessment | — | Not building |
| P6 | Goals at the start of probation | — | Not building |
| P7 | Improvement plan for low ratings | — | Not building |
| P9 | Early confirmation or early termination | — | Not building |
| P8 | Record what HR did about flagged feedback | 4 | On disk |
| P10 | Previous evaluation shown on the form | 3 | On disk |
| P11 | Save the form as a draft | 3 | On disk |
| L1 | Probation length and frequency set per person | — | Not building |
| L2 | Screen to edit the evaluation questions, and question sets by role | — | Not building |
| L3 | More fields on the employee record | — | Not building |
| L4 | Public holiday calendar | — | Not building |
| L5 | Microsoft sign-in for HR users | — | Not building |
| L6 | Move a whole team to a new manager at once | — | Not building |
| L8 | Advance "evaluation coming up" email to managers | — | Not building |
| L7 | HR notes on a Commando (attachments: not building) | 5 | On disk |
| U1 | "4 of 7 answered" on the form | 3 | On disk |
| U2 | Missing rating linked and marked | 3 | On disk |
| U3 | Rating options grouped for screen readers | 3 | On disk |
| U4 | One date format | 1 | On disk (with H6) |
| U5 | More filters on the Commandos list | 5 | On disk |
| U6 | Sortable columns and export | 5 | On disk |
| U7 | Search fired on every keystroke | 1 | On disk |
| U8 | Pick manager and project leader from the directory | 5 / 6 | On disk |
| U9 | Ask before sending past-due evaluations | 4 | On disk (with B5) |
| U10 | "Record decision" and "Mark as left" as their own actions | 2 | On disk |
| U11 | "Probation ends" and "Decision due" on the Commando page | 2 | On disk |
| U12 | Readable change history | 1 | On disk |
| U13 | Show who actually answered | 4 | On disk (with M3) |
| U14 | Manager portal — let managers read their own past answers | — | Not building |
| U15 | Manager portal — "doesn't report to me any more" button that alerts HR | — | Not building |
| H1 | AD data sync | 6 | On disk. Filtering (contract staff out, interns in), Leaders-list project leader, review kept with suggested date and track, review email and daily reminder (07-10-2026). Adding joiners automatically: withdrawn. |
| H2 | Remove "Overall trends" from Trends | 1 | On disk |
| H3 | Duplicate figures on the board | 1 | On disk |
| H4 | Remove the work list, keep the email log | 1 | On disk |
| H5 | Remove "All seven ratings" | 1 | On disk |
| H6 | Dates as dd-MM-yyyy | 1 | On disk |
| H7 | Rename to "AAPNA Probation Period Evaluation Platform" | 1 | On disk |
| H8 | Probation mentioned in every email | 3 | On disk |
| H9 | "Employees" → "Commandos" | 1 | On disk |

### Waiting on

The short list. Each line is set out in full under "Pending" below.

| What | Who | Blocks |
|---|---|---|
| Review of Phases 1–6 and the tidy-up — in progress, one point at a time in the order of HR's email | Harish | Everything moving past "On disk" |
| Apply the DDL on staging | Harish / DBA | Staging test of P11, all of Phase 4, and L7 (notes) |
| Say whether to commit, and how | Harish | Anything leaving this machine |
| Confirm: dd-MM-yyyy and "Commandos" also apply to the manager's form and emails | Harish | Nothing; it is built that way |
| Confirm: HR role (not only admins) may record a decision, mark as left, reopen, delegate, enter ratings | Harish | Nothing; it is built that way |

No longer waited on: a Microsoft 365 permission for the two lists (none is needed), and the five decisions answered on 02-10-2026 — see that day below.

---

## Pending

As of 02-10-2026. All the code for this round is written. None of it is reviewed, committed, on staging or released. This section lists everything that still has to happen, in the order it has to happen. Tick a box when it is done.

### 1. Review — Harish

Nothing moves past "On disk" until it is read and accepted.

Started 05-10-2026, one point at a time, in the order of HR's email (Item 1 = H1). Outcomes so far:

| Item | Point | Outcome |
|---|---|---|
| 1 | H1 | Filtering accepted. Adding joiners automatically was asked for on 05-10-2026 and withdrawn on 07-10-2026: Microsoft 365 will not hold the joining date or the experience, so the review stays. Built instead: suggested date and track, and a review email with a daily reminder — see 07-10-2026 below. |
| 8 | H8 | Checked 05-10-2026. Every email about one Commando carries the probation period and "evaluation N of M". The bell notifications did not; added the same day, as asked. Four templates edited on staging keep their old wording until reset. |
| 9 | H9 | Checked 05-10-2026. No "Employee" left in anything a person reads — screens, emails, form, Excel, bell, messages. Left as they were: the `/employees` address, the `{{employee_name}}` placeholder names, and server log lines. |
| 2 | H2 | Final review 07-10-2026. The small six-month line beside "Average rating" on the Evaluations board was "Average Rating by Month" in miniature: removed. |
| 3 | H3 | Final review 07-10-2026. The board was done on 01-10-2026. The Commando page repeated the submitted count, the probation end and the next due date in its header: removed there, kept in the "Probation progress" card. |
| 4, 5, 7 | H4, H5, H7 | Final review 07-10-2026: done as asked. For H4, HR's question is answered: the work list is removed; the Email log stays as the record of every email PEA sent. |
| 6 | H6 | Final review 07-10-2026: done. The Dashboard greeting keeps its written-out date ("Monday, 5 October 2026") — Harish: that's fine. |
| 1 | H1 | Final review 07-10-2026: built as far as Microsoft 365 allows. HR still confirms each joiner once — HR is to be told why. |

- [ ] Phase 1 — HR's email and quick fixes (13 points)
- [ ] Phase 2 — the probation rule (6 points). The one phase that changes what a manager is asked and when.
- [ ] Phase 3 — manager form and emails (6 points)
- [ ] Phase 4 — who answered, and HR actions on one evaluation (9 points)
- [ ] Phase 5 — Commandos list and page (4 points)
- [ ] Phase 6 — AD sync (H1, and the directory half of U8)
- [ ] Top bar and Evaluations board tidy-up. An earlier redesign (the manager's form) was built and rejected, so this one needs a look before it is taken as accepted.
- [ ] The DDL file, `backend/prisma/ddl/2026-10-02-pea-review-round.sql`, read before anyone runs it.
- [ ] The places where each phase differs from the plan. They are listed under each phase below ("Where Phase N differs from the plan"). Each is a choice made while building and can be changed.

### 2. Decisions still open

None of these blocks the build. Each says what PEA does today and what an answer would change. Five were answered on 02-10-2026 and are no longer here; they are recorded under that day.

| # | Decision | Who | What PEA does now | What an answer changes |
|---|---|---|---|---|
| 1 | dd-MM-yyyy and "Commandos" on the manager's form and in emails, not only on HR's screens | Harish | Applied everywhere. | A "no" means undoing them on the form and in the emails. |
| 2 | May the HR role (not only admins) record a decision, mark as left, reopen, delegate and enter ratings | Harish | Yes, all five. | A "no" means raising those routes to admin. |
| 3 | Past-due evaluations when someone is added late: is "ask the manager for the latest one only" the right default | Harish / HR | That is the choice already selected in the dialog. | Changing which choice is preselected. |
| 4 | Reminders: are two per evaluation enough | HR | Two at most; the database enforces it. | More than two means lifting a database check — a DDL change. |
| 5 | Backend lint | Harish | `npm run lint` does not run; there is no ESLint configuration file. | Either add one, or remove the script. |
| 6 | "Leaders list only": should the project leader box also refuse, or warn about, an address that is not on the Leaders list | Harish | No. The list supplies the suggestion; HR can still type or pick anyone as project leader. | A "yes" is a check on the Add, Edit and Confirm forms. |

### 3. Database

- [ ] Apply `2026-10-02-pea-review-round.sql` on **staging**. One transaction, additive, safe to run twice.
- [ ] **Run it as `peauser`** — the owner of the PEA tables. Tried as `appuser` on 07-10-2026: it stops at its first check ("pea_evaluation_cycles not found — wrong database?") because `appuser` has no rights on the PEA tables, and only the owner can add columns anyway. Nothing was changed. Harish does not hold `peauser`; the database owner is to run it.
- [ ] Check its last query: 23 rows, every one reporting 1. (It was 18; 07-10-2026 added "email_type allows joiners_waiting" and the four archive columns.)
- [ ] Apply it on **production** before the build goes there, and check the same 23 rows.
- [ ] **Know the first archive run before it happens.** After the build is in, the server log at start-up says "[archive] dry run: N Commando(s) would be archived". Everyone already confirmed, not confirmed or left is archived the next morning at the sweep time.

Until it is applied, on any database, the build still runs and these are simply absent:

| Not available until the DDL | Point |
|---|---|
| "Save draft" on the manager's form | P11 |
| Send to someone else, Reopen, Record what was done, Enter ratings | M7, M6, P8, HR entry, M8 |
| Who the link went to and who actually answered | M3, U13 |
| The Notes card | L7 |
| The decision's reason and date on the Commando page (they are in the change history either way) | U10 |
| The "new joiners waiting for review" email — the bell still rings without it | H1 |
| The archive: nobody is archived, the Archived filter and the Archive / Restore actions are not offered, and every list is as before | Archive |

Phase 6 needs no DDL. No `prisma generate` is needed either: `schema.prisma` is unchanged.

### 4. Testing still to do

What has been done so far: the backend's 415 automated tests, a frontend build, read-only runs of the Commandos list against staging data and of the directory rules against the tenant, and screenshots of the Evaluations board and top bar with saved data. **No screen has been used by a person, and no part of this round has run against a database with the DDL applied.**

Everything below is on staging, with the email redirect on.

**Phase 1**

- [ ] B6 — a Commando's own link shows the real "N of M submitted".
- [ ] B7 — "Close this tab" on the thank-you page and on an error page, in Chrome and Edge, and what it says when the browser refuses.
- [ ] B8 — the form says "HR reads these." with self-view below "full", and the earlier wording with "full".
- [ ] H2, H3, H5 — Trends, the board and the evaluation page no longer show the removed parts.
- [ ] H4 — "Email log" opens; the old `/evaluations/worklist` address lands on it.
- [ ] H6 / U4 — dd-MM-yyyy on every screen, in every date picker, on the manager's form, in an email, in a bell notification and in the Excel export.
- [ ] H7, H9 — the new name and "Commando" everywhere a person reads, including the browser tab and the print header.
- [ ] U7 — the Commandos search waits for typing to stop.
- [ ] U12 — the change history reads in plain words; "Show all (N)" works.

**Phase 2** — one fresher and one experienced record, each walked from the final evaluation onward

- [ ] Extend 2 at the final evaluation: two more evaluations appear, 30 and 60 days on.
- [ ] Extend 1, then extend 1 again: the second covers the next month, not the same days (B1).
- [ ] At the 8-month limit the form offers Confirm and Do not confirm only, and says why (B2).
- [ ] An old copy of the form that sends "Extend" past the limit is refused with a clear message.
- [ ] Record decision…: each option, the reason required for all but Confirmed, a future date refused, "Back to in probation".
- [ ] Extend recorded by HR schedules its evaluation (B3).
- [ ] Mark as left… closes open evaluations and kills the manager's link; Mark as active again… reverses the status only.
- [ ] "Probation ends" moves when an extension is granted; "Decision due — ended N days ago" turns from amber to red after 7 days (U11).

**Phase 3**

- [ ] U1 — "4 of 7 answered" stays in view and counts as answers are given.
- [ ] U2 — submit with a rating missing: the summary links to the question and the question is marked.
- [ ] U3 — the form by keyboard alone, and with a screen reader.
- [ ] P10 — "Last time" shows under each question from the second evaluation on; not for an imported free-text one.
- [ ] P11 (needs the DDL) — Save draft; autosave; open the same link on a phone and find the draft; submit clears it; the board card says "draft saved".
- [ ] H8 — send each of the nine emails and read the subject and the probation line.
- [ ] H8 — the bell after a manager submits, after a final evaluation with "Extend", and after Record decision: each states "evaluation N of M" and the probation end date, and the extended date after an extension.
- [ ] H8 — **four templates are already edited on staging** and keep their own wording, so they will not show the probation line: the evaluation request, the reminder, the acknowledgement and the manager's team link. For each, either press Reset on the Email templates screen or add `{{probation_line}}` by hand. Production has no edited templates.
- [ ] The form with JavaScript off still submits.

**Phase 4** (all of it needs the DDL)

- [ ] Change a manager with one link sent and one opened: the old links say "invalid", new ones arrive, drafts are gone, the toast and the change history say how many moved.
- [ ] Send one evaluation to an acting manager; let a reminder go out; submit it; check whose name it is recorded under.
- [ ] Resend one that is with an acting manager: it goes back to the reporting manager.
- [ ] Reopen the latest submitted evaluation, once with a decision on it and once without; resubmit; the earlier version is shown.
- [ ] Reopen is refused, with the reason, when a later evaluation has gone out.
- [ ] Record a follow-up; it leaves "Needs attention" for a second HR user too.
- [ ] Add someone who joined four months ago under each of the four past-due choices.
- [ ] Hold someone past a due date, then resume, and get the same question.
- [ ] "Enter ratings" on a closed evaluation, with "Copy from evaluation N".
- [ ] Before the DDL: none of these buttons is offered, and the API answers 503 with the reason.

**Phase 5**

- [ ] Each of the seven Status filters and the manager filter, alone and together with search and type.
- [ ] Sort by each of the four headings, both ways, then turn a page.
- [ ] Export with a filter and a sort on; the file matches the list.
- [ ] Pick a manager by name in Add, Edit, New-joiner confirm and "Send to someone else…": the email fills in and a project leader is suggested.
- [ ] Pick a manager who has nobody on the Leaders list at or above them: no project leader is filled in and the note says to choose one. (Today every manager reaches a leader, so this needs a test account.)
- [ ] Type a name that is not in Microsoft 365: it is kept as typed and the form still saves.
- [ ] Notes (needs the DDL): add one; delete it as its author; try to delete another HR user's note as a non-admin; delete one as an admin; check the change history.
- [ ] Print the Commando page: the notes are not on it.
- [ ] A Commando's own link and a manager's portal link show no notes.

**Phase 6** — rehearsed read-only against the tenant; a real scan has not been run

- [ ] "Test run" on New joiners: read "left out", and check a known contractor created in the last 45 days is counted there.
- [ ] A new account on `mera.work` or `karyakeeper.com` is offered like any other.
- [ ] A known joiner's project leader comes from the Leaders list, and the screen says so.
- [ ] The first real scan takes one of the two joiners now waiting off the inbox, with the reason "No manager in Microsoft 365", and names the new accounts it left out for the same reason. Check that is who was expected.
- [ ] "Scan now": a contractor already waiting leaves the inbox with the reason "Contract staff".
- [ ] Put a wrong Contractor list id in Settings: the check stops, changes nothing, and HR gets the "Microsoft 365 check failed" alert saying nobody is on the list. Put it back.
- [ ] Clear the Contractor list id: the rule is off and New joiners says contract staff are not being filtered. Put it back.
- [ ] Give a left-out account a manager in Microsoft 365 (or switch "New accounts with no manager" to "show"): it appears in the inbox on the next scan. Switch back to "leave out": it leaves again.
- [ ] Clear the Leaders list id: no project leader is suggested for anyone. Put it back.
- [ ] "Refresh project-leader suggestions" is gone from New joiners, and "Rebuild map" from Upload sheet.
- [ ] Add an address to "Never offer these as joiners": it leaves the inbox on the next scan.
- [ ] The nightly check, once, on its own schedule, and how long it took.
- [ ] The leaver check still flags a disabled, unlicensed account and still holds its evaluations.
- [ ] A new account: the suggested joining date is the day after the account was created; the screen says so.
- [ ] A new account titled "Associate …" shows "Experienced" with Check in the inbox, and arrives preselected in Confirm. Changing it to Fresher before confirming gives the 6-evaluation schedule. A title with no listed word shows "Missing" and the row asks for Review.
- [ ] Change a designation word in Settings → New joiners: the inbox shows the new suggestion at once, without a scan.
- [ ] "Scan now" that finds a new joiner (needs the DDL for the email): one "new joiners waiting for review" email reaches the test inbox, and the bell rings for HR and admins.
- [ ] The next day at the sweep time (11:00): the reminder email and bell arrive while anyone is still waiting; not on a day an arrival email already went; none once the inbox is empty.
- [ ] An HR user with New joiners switched off in Module Access is not emailed; an inactive user is not emailed.
- [ ] Before the DDL: the bell rings, no email goes, and the log says why.

**Archive** (needs the DDL)

- [ ] The start-up log's dry-run count matches who is confirmed, not confirmed or left.
- [ ] The next morning they are archived: each has a change-history line, and one bell says how many.
- [ ] Archive by hand from More → Archive…, with a reason; then Restore. The person comes back and is not archived again the next morning.
- [ ] Record a new decision for a restored person: they are archived the morning after.
- [ ] Commandos → Status → Archived lists them; a search by name finds them with an "Archived" pill; the default list does not.
- [ ] An archived person's page: the notice, Restore, Download and Share report work; Edit, Record decision, Commando link, notes and Send are not offered, and the API refuses them.
- [ ] Their evaluations open read-only, with no actions; they are not on the board, the Dashboard, Trends, or their manager's team link; their own link no longer opens.
- [ ] A Not Confirmed final evaluation nobody has opened: the person is not archived until someone opens it or records a follow-up.
- [ ] The Microsoft 365 check no longer flags an archived person as a possible leaver.
- [ ] Settings → Probation → "Archive Commandos this many days after the probation ends": set to 30 and check nobody decided this month is archived.

**New Joiner Inbox table**

- [ ] With real joiners on a normal screen: one line per cell; a long name or address ends in "…" and shows in full on hover; Confirm / Review and × are always visible; the buttons' tooltips say what is missing or to check.

**Top bar and board**

- [ ] The top bar on every screen, in both themes — only the board was looked at. In particular a Commando page with a long name, the sidebar collapsed, and a phone.
- [ ] The Admin Portal. It has its own top bar, which was not touched; check the two do not look mismatched.
- [ ] The board with real data: many cards, the "Needs attention" banner, paging, and the toolbar staying in place while the list scrolls.
- [ ] The account menu opens from the keyboard.

**Automated**

- [ ] The browser test suite in `frontend/e2e` has not been run since this round started. It needs both servers running and `.env.e2e` filled in. `notice-strip.spec.js` was edited in Phase 1, and New joiners has gained notices since.
- [ ] The scripts in `backend/scripts` (`e2e-scheduler.js` and the others) have not been run against the new code. They write to the database they are pointed at.

### 5. Commits

Harish committed the round on 05-10-2026 as `d23df51` (85 files). The work since — the H1 follow-up, the final review changes, the archive and the inbox table — is not committed yet. No commit is made until asked for.

- [ ] **The flow export went into `d23df51`.** `MRAReconcile-v3-C7D5B118-8CAB-F111-AAAB-7CED8DBA44E7.json`, with the flow's client secret in plain text, is in that commit. As far as this clone knows the branch has not been pushed (it has no upstream, and no remote branch contains the commit). Before anything is pushed: take the file out of the commit (amend or rewrite that commit), add it to `.gitignore`, and keep it outside the repository. If the commit has been pushed or shared anywhere, rotate the secret on the flow's app registration (`3dc7c91e-…`).
- [ ] Say how to commit the work since 05-10-2026.
- [ ] `package-lock.json` at the top of the repository is new and untracked — not from this work's changes; decide whether it belongs.
- [x] ~~`docs/` is untracked as a whole.~~ It went into `d23df51`, with the feedback PDF.
- [x] ~~`DEPLOYMENT.md` moved into `docs/`.~~ It went into `d23df51` as a move.

### 6. Release

- [ ] **Staging:** DDL, then backend, then `npm run build:staging` for the frontend, then restart. `docs/DEPLOYMENT.md` sections 3, 4 and 6. The frontend has only been built into a scratch folder; `frontend/dist` is not rebuilt.
- [ ] After the staging deploy, press "Test run" on New joiners before the first nightly check. Every directory rule takes effect on the first scan after the build is in place, with nothing to switch on: three domains, contract staff and no-manager accounts left out, project leader from the Leaders list.
- [ ] Nothing has to be changed in Settings for the three domains. They are stored under a new setting, "Joiner email domains". The older one-domain row (`azure_email_domain`) stays in the database untouched and unread; do not put a list into it — the build on staging today reads it as one domain.
- [ ] Walk the checklist in section 4. Then the phases move to "On staging".
- [ ] **Production:** DDL first, then the build. `docs/DEPLOYMENT.md` sections 7 and 9. Production has no edited templates today. If its database is ever made from a copy of staging, the four templates edited on staging come with it.
- [ ] Tell HR what changes for them. The list is the "What changed" column of each phase below.

### 7. Not pending — left out on purpose

So that nobody reads these as forgotten.

- The 21 review points marked "Not building" in the table above. Each was answered "later" or "won't do" in the review.
- L7 attachments. Notes only; attachments wait for a decision on where files are stored and backed up.
- "Send to someone else…" in the schedule row on the Commando page. It is on the evaluation page only.
- An "Include handled" filter on the board (P8).
- Sorting the Commandos list by "Next due" (U6).
- A decision inside "Enter ratings". It is recorded with "Record decision…".
- Restyling any screen other than the Evaluations board.
- The map of reporting manager to project leader learned from the current Commandos. Its table, its routes and its code are still there; nothing reads it for a suggestion any more.
- Unlicensed accounts as joiners. Confirmed 02-10-2026: never offered.
- The alignment fixes from the 05-10-2026 check. Previewed and declined — the design stays as it is. The findings are kept under that day in case any is wanted later.
- Adding new joiners without a review. Asked 05-10-2026, withdrawn 07-10-2026: Microsoft 365 will not hold the date of joining or the years of experience.
- An Interns list. Interns stay in the inbox like permanent staff (07-10-2026); only contract staff are left out.
- A switch to turn the review email or its reminder off. Not asked for; the template can be edited on the Email templates screen.
- "Save and finish later" in the New-joiner Confirm window. Declined 07-10-2026: half-confirmed joiners would leave loopholes. A joiner is saved only by "Add and schedule", with every required value; closing the window keeps nothing.

### 8. Noticed, not changed

Seen while working. None is part of this round; each needs a yes before it is touched.

- [ ] **Link generation asks for 500 Commandos and gets 200.** `ManagerLinks.jsx` sends `limit: 500`; the list stops at 200. It matters once there are more than 200 Commandos.
- [ ] **The MRA Reconcile flow, "Condition Manager Exist".** It compares the manager's list id with `true`, so it always takes the Update branch; a manager not yet in the SharePoint list would be updated with an empty id, not created. This is in the flow, not in PEA.
- [ ] **`npm test` reads the database in `backend/.env`**, which today is the staging database. The tests only read. A test that wrote would write to staging.
- [ ] **Excel export dates are text**, dd-MM-yyyy. Nothing reads an export back today; if anything ever does, `05-03-2026` would be read as 3 May.

---

## 07-10-2026

### Archive (07-10-2026)

Asked for by Harish: "some archive mechanism for those who are confirmed or not confirmed after 6–8 months".

| Question | Answer (Harish) |
|---|---|
| How | Automatically, and by hand; HR can also restore. |
| When | Straight away — the morning after the decision or exit. A setting ("Archive Commandos this many days after the probation ends", Settings → Probation) starts at 0. |
| Who | Confirmed, Not Confirmed, and anyone marked as having left. |
| What they keep | A read-only record. Nothing is deleted or moved. |

What the person using PEA sees:

| Where | What changes | Commented out / kept |
|---|---|---|
| Every morning (the sweep time) | Everyone whose probation is over is archived: a change-history line each ("Archived automatically — Confirmed on dd-MM-yyyy") and one bell, "N Commandos archived". Someone whose recent flagged feedback nobody has opened waits until someone has. A Commando HR restored is not archived again until a new decision or exit. | — (new) |
| Commandos list | Archived people are out of the list, its export and the manager filter. Status → **Archived** shows them; a search by name finds them too, with an "Archived" pill. | — (filters added; nothing removed) |
| Commando page | An archived person's page opens with "Archived on … by …" and **Restore**. Edit, Record decision and Commando link are not shown; the More menu has Download, Restore and Delete. Notes are read-only; Send / Resend are not offered. For someone whose probation is over and who is not archived, More → **Archive…** with an optional reason. | The three buttons wrapped, not removed; the old More-menu Download and Delete items written out as shared constants. |
| Evaluation page | For an archived person: "… is archived — this evaluation is read-only", and no action is offered. | The old actions block, kept as a comment. |
| Board, Dashboard, Trends, manager's team link | Archived people are left out of every list and figure. On the Dashboard, "N confirmed · N extended" under In probation is now "N extended · N archived", the second a link to the archive. | The old tile line. |
| Commando's own link | Stops for an archived person, as for a leaver. | — |
| Microsoft 365 check | Archived people are not checked for leaving, not name-synced, and not in Possible leavers. They are still known as Commandos, so never offered again as joiners. | The old `where`. |
| Every action that changes a record | Refused for an archived person with "… is archived, so the record is read-only. Restore them first". Delete (admin), Download and Share report still work. | — |

Files: new `backend/src/services/archive.service.js`, `backend/src/utils/archiveScope.js`, `backend/src/tests/archive.test.js` (18 tests); `schemaCapabilities.js` (`hasArchiveColumns`); `employee.service.js`, `export.service.js`, `evaluationBoard.service.js` (also `unreadFlaggedByEmployee`), `evaluationList.service.js`, `dashboard.service.js`, `analytics.service.js`, `managerPortal.service.js`, `selfView.service.js`, `joinerIntake.service.js`, `evaluationActions.service.js`, `settings.service.js`; `controllers/employee.controller.js`, `routes/employee.routes.js` (`POST /api/employees/:id/archive`, `/restore`); `jobs/evaluationScheduler.js` (the morning pass, and a dry run logged at start-up); the DDL (four columns, an index, four verification rows); frontend `Employees.jsx`, `EmployeeDetail.jsx`, `EvaluationProfile.jsx`, `Overview.jsx`, `EmployeeNotes.jsx`. `reviewRoundPhase5.test.js` updated for the eighth status (old assertion kept as a comment).

Where this differs from the plan: the setting is under Settings → Probation, not Evaluations.

Not tested on a database: no archive has been written anywhere. Checked with the automated tests and with screenshots from made-up data.

### New Joiner Inbox table (07-10-2026)

Asked for by Harish, with a screenshot: names broke letter by letter in a squeezed Name column, and "To fix" ran to six lines. "Keep table clean."

| What the person using PEA sees | Commented out |
|---|---|
| One line per cell, at fixed widths: Name (name over email), Joining date, Fresher or experienced, Reporting manager, Project leader, and the Confirm / Review and × buttons. A long name or address ends in "…" and shows in full on hover; nothing is squeezed. | The whole column set before, as a comment after the table. |
| "Account created" is no longer a column: it is in the joining date's tooltip (the suggestion is the day after it). | (in that comment) |
| "To fix" is no longer a column: it repeated the Check / Missing marks. What it said is now the Confirm / Review button's tooltip. | (in that comment) |
| Fresher or experienced has its own column instead of sitting under the date. | — |

On a screen narrower than about 1,250 px the table scrolls sideways rather than squeezing. The Evaluations board, which has a similar person cell, was checked and is unchanged.

### Summary

- Microsoft 365 will **not** hold the date of joining or the years of experience (Harish). So the New Joiner Inbox review stays, and "add joiners automatically" (05-10-2026) is withdrawn.
- PEA now **suggests** both — the joining date and fresher or experienced — and HR or an admin confirms them. Nothing is final until a person presses Confirm.
- Admins and HR are **told when a review is needed**: an email and the bell when a scan finds new joiners, and a daily reminder while anyone waits.
- Backend tests: 459 of 459 pass. The frontend builds. The inbox and the email were checked by eye with made-up data.

### Decisions

| Question | Answer |
|---|---|
| Microsoft 365 and the joining date / experience | Not held, and not going to be. The review stays. |
| Contract staff | Left out through the Contractor DL — already built on 01-10-2026, confirmed. |
| Interns | **Stay in**, as HR's email said. No Interns DL. |
| Project leader | The manager if on the Leaders DL, else the manager's manager, and so on up (six levels) — already built, confirmed as the flow's approach. |
| Joining date suggested | The day after the account was created (India date). HR confirms it. |
| Fresher or experienced | Suggested from the designation (job title); HR confirms it. "Associate" means one to two years' experience, so it suggests Experienced. |
| Who is emailed | Every active Super Admin and Admin, and every active HR user who can open New joiners. |
| When | When a scan finds new joiners, and a daily reminder while anyone is still waiting. |

Designation words (editable in Settings → New joiners). Whole words, ignoring case; words from both lists → Experienced; neither → no suggestion, HR chooses.

| Suggests | Words |
|---|---|
| Fresher | intern, trainee, fresher, graduate, apprentice, junior |
| Experienced | associate, senior, sr, lead, manager, architect, principal, head, specialist, consultant |

### What changed

| Where | What the person using PEA sees | Commented out |
|---|---|---|
| New Joiner Inbox | The suggested joining date is the day after the Microsoft account was created; the hint says so. Under it, "Experienced" or "Fresher" with a **Check** mark, from the designation — or **Missing** when the title suggests nothing. "To fix" lists fresher or experienced, to add or to check. | The old date rule and its hint; the old "To fix" rule noted. |
| Confirm dialog | Fresher or experienced arrives preselected when the designation suggests one, with "Suggested from the designation … — check before confirming". Otherwise blank, as before. | `is_experienced: undefined`; the old hint texts. |
| Email | New email "N new joiner(s) waiting for review" to admins and HR: who is waiting, the suggested date and track, the manager and project leader, days waiting, and what is still to do, with a button to New joiners. Editable on the Email templates screen. | — (new) |
| Bell | On arrival: "N new joiner(s) waiting to be confirmed", as before, now saying both values are only suggestions. Daily: "N new joiner(s) waiting for review", with the oldest wait, once a day. | The old arrival notification block. |
| Daily reminder | At the daily sweep time (11:00 by default), while anyone waits — but not on a day an arrival email already went out. Not sent by "Send due emails now…". | — (new) |
| Settings → New joiners | Two new settings: "Designation words that suggest Fresher" and "… Experienced". Blank switches that suggestion off. | — (new) |

Files:
- `backend/src/services/entraDirectory.service.js` — reads `jobTitle` too (still `User.Read.All`, nothing new).
- `backend/src/services/directory.service.js` — `TITLE_WORD_DEFAULTS`, `trackFromTitle`, `titleWordRules`.
- `backend/src/services/joinerIntake.service.js` — the next-day date, the title kept in `raw_graph`, `serialiseCandidate` with the suggestion, `joinerReviewRow`, `dailyReminderDue`, `notifyJoinersWaiting`.
- `backend/src/services/notification.service.js` — `reviewRecipients` and the `joiners_waiting` recipients.
- `backend/src/services/emailTemplate.service.js` — the `joiners_waiting` template, its placeholders and table.
- `backend/src/services/settings.service.js` — the two settings and the `word_list` type.
- `backend/src/utils/schemaCapabilities.js` — `hasEmailType`.
- `backend/src/jobs/evaluationScheduler.js` — the daily reminder after the sweep.
- `backend/prisma/ddl/2026-10-02-pea-review-round.sql` — `joiners_waiting` added to the email-type check, and a verification row.
- `frontend/src/pages/NewJoiners.jsx`, `frontend/src/pages/Settings.jsx`.
- Tests: new `backend/src/tests/joinerReview.test.js`; `joinerIntake.test.js` updated (the old date assertion kept as a comment) and two cases added.

### Final review of HR's email (07-10-2026)

All nine items checked against the code and screenshots. Two changes made, approved by Harish:

| Item | What the person using PEA sees | Commented out |
|---|---|---|
| H2 | The "Average rating" card on the Evaluations board shows the number only. The six-month line beside it is gone. | The `<TrendLine>` on the card, the `TrendLine` helper, the monthly-average query in `summarise()` and `stats.averageTrend` (`evaluationBoard.service.js`). |
| H3 | The Commando page header shows the name, the line under it, the status, the trend and any warning (on hold, may have left, left, decision due). The submitted count, the probation end and the next due date are in the "Probation progress" card only. The header's "Next due" also showed a different date from the card's (the evaluation already sent, not the next one to send). | The three header pills and `nextOpen`. |

Left as it is: the Dashboard greeting's written-out date (H6). The decision still shows in the header (as the status) and in the card (with who recorded it, when and why).

Backend tests: 459 of 459 pass. The frontend builds. Both screens checked by eye with made-up data.

Also fixed: the message shown when Confirm is pressed with no joining date still said the suggestion was "the Microsoft account creation date". It now says "the day after the Microsoft account was created"; the old wording is kept as a comment.

Where this differs from the plan:
- The date-source value is `created_next_day`, not `account_created_next_day`: the column holds 20 characters.
- A joiner with no suggested track now shows "Missing" and the row button reads "Review". The dialog could never be confirmed without it; the table did not say so.

Not tested: any of it on staging. The email needs the DDL; before it, the bell rings and the email is skipped with a log line. No real scan was run.

---

## 06-10-2026

### Decisions — H1, adding joiners automatically

| Question | Answer |
|---|---|
| A new account that does not say fresher or experienced | **Waits in the inbox** for HR to answer that one question. Nothing is guessed. |
| Evaluations already past due for someone added automatically | Not expected to happen. If it does: nothing is sent for them, and HR or an admin enters the missing ratings in the app ("Enter ratings" on the evaluation page, built in Phase 4 — needs the DDL). |
| Which field says fresher or experienced, and with what values | Asked of the admin / IT team. **Waiting.** |
| Which field holds the date of joining | Asked of the admin / IT team. **Waiting.** Where it is empty: the day after the account was created (05-10-2026). |

Paused at Harish's request until IT answers. No code changed.

---

## 05-10-2026

### Summary

- Review started, one point at a time, in the order of HR's email.
- Item 1 (H1) answered: PEA is to add new joiners by itself, without HR confirming each one in the New Joiner Inbox.
- No code changed. Waiting on which Microsoft 365 fields to read.
- Items 8 (H8) and 9 (H9) checked against the code. Both are in place for emails and screens.
- H8 extended to the bell notifications, as asked. Backend tests: 425 of 425 pass.
- Alignment check of the whole app, asked for after a screenshot of the Commandos list. Findings below. Two fixes for the Commandos rows were previewed; Harish did not like either. **Decision: leave the design as it is.** No code changed.

### Alignment check — findings (no code changed)

How it was checked: every screen (22, plus the manager's form) opened in Edge at 1440, 1280 and 390 px wide, with made-up data answering the API — no database, no backend, no real names. Each screen was screenshotted, and the rows, toolbars and icons were measured.

| # | Where | What is wrong |
|---|---|---|
| 1 | Commandos list | Rows zig-zag: the "1 awaiting / overdue" pill under the progress bar and "May have left" under the status lift those cells 12–13 px above the rest of the row, and only in some rows. The one in the screenshot. |
| 2 | New joiners, inbox | The Name column shrinks to about 40 px: names and addresses break letter by letter, dates break over two lines, cells in one row are up to 100 px apart. |
| 3 | Evaluation page, question by question | The rating column moves: when nothing changed since last time the "↓1 since E2" slot disappears and the rating slides right; "Highly Satisfied" is wider than its slot. |
| 4 | Evaluation page, "answered by" | The name drops onto the next line, away from its avatar. |
| 5 | Evaluations board, filter row | Search and the two dropdowns are 38 px tall; the date range and Cards / Table are 32 px. |
| 6 | Settings | Each on/off switch sits 7 px higher than its Save button. |
| 7 | Top bar | Email warning 30 px, icon buttons and Admin Portal 36 px, account chip 40 px — centred, but not one height as the tidy-up intended. |
| 8 | Tables wider than their card | Right-hand columns hidden behind a sideways scroll: Evaluations board table (at 1280 the overall comment and comments are both off-screen), Email log (Subject cut, Status off-screen), Trends ("Biggest parameter drop" cut), Commando page comment grid (last column cut). |
| 9 | Commando page header | The action buttons keep the whole right side, so the facts and pills under the name squeeze into a narrow column (pills one per line). "Overdue (not yet sent)" wraps; the Details and Probation progress cards differ in height. |
| 10 | Smaller spacing and sizing | Link generation's two cards touch; Email templates' toolbar sits tight under the heading; "Remind now" is compact while the three buttons under it are full width; the Notes "Add note" button and character count sit on different lines; Trends filter placeholders are cut ("Fresher and experie…"); "Your average" heading wraps on the manager portal. |
| 11 | Colour | Upload sheet's "When to use this" box is dark grey-green, unlike every other notice. |
| 12 | Phone width (390 px) | Six pages scroll sideways (Commandos by 382 px, New joiners 327, Link generation 245, Settings 135, Email log 125, Evaluations board 57); the top bar loses the account menu off the right edge; Dashboard lists wrap word by word. |
| — | Manager's form | No measured problem. The fifth rating option spans a whole row under four equal boxes — that is the original design, kept as asked on 01-10-2026. |

Tables whose rows are already even: Evaluations board (table), Trends, Link generation, Possible leavers, Admin users — each has a two-line name cell in every row and everything else on one line, so every row looks alike.

Proposed rule for tables: rows are centred; only the name cell has two lines (name over email); every other cell stays on one line. For the Commandos list that means the "awaiting / overdue" pill after the 3/6, and "May have left" beside the status. A first-line alternative (every cell starts on the top line) was also previewed.

### What changed — H8 in the bell

| Notification | Before | Now | Commented out |
|---|---|---|---|
| A manager submits an evaluation | "Evaluation 3 submitted — Priya Sharma" · "Evaluation 3 · 3.43 / 5 · …" | "Evaluation 3 of 6 submitted — Priya Sharma" · "Evaluation 3 of 6 · probation ends 28-12-2026 · 3.43 / 5 · …" | The old title and body, noted beside the new ones. |
| A manager's final evaluation carries a decision | "Priya Sharma: Extend for 1 month" · "Evaluation 6 · …" | Same title · "Evaluation 6 of 7 · probation ends 27-01-2027 · …" — the extended end | As above. |
| HR records a decision | "… Recorded by hr. 1 extension evaluation(s) scheduled." | The same, then "Probation ends 27-01-2027." | — (one sentence added at the end; noted) |

- "ends" becomes "ended" once the date has passed.
- The timeline is read after the submission or decision is saved, so an extension it granted is already counted.
- If the timeline cannot be read, the notification reads exactly as before.
- Files: `notification.service.js` (`probationNote`, and `probationContext` exported), `evaluation.service.js`, `employee.service.js`, `tests/emailTemplate.test.js` (5 tests).
- Not changed: "Confirmation overdue" already gives the deadline; the joiner, leaver, settings and send-failure notifications are not about one probation.

### Decision — Item 1 (H1)

HR's item: fetch only interns and permanent AAPNAites from AD, with no manual checking of each one.

| | |
|---|---|
| Already on disk | Contract staff (the Contractor list), switched-off, unlicensed, off-domain, system mailbox, excluded and no-manager accounts are left out automatically. HR still confirms each remaining joiner once. |
| Asked for | Option 2 — add each joiner automatically. |
| Fresher or experienced | To be read from Microsoft 365. Harish: "this can be checked within AD itself". Which field, and which values mean fresher and experienced, is not yet known. |
| Date of joining | From Microsoft 365 where it is held. Where it is not: **the day after the account was created**. |

Not yet known, and needed before building:

1. The field that says fresher or experienced, and its values. In September `employeeType` was empty for every account, so it is probably another field (a job title, an extension attribute, a group).
2. The field that holds the date of joining. In September `employeeHireDate` was empty for every account; it may have been filled since.
3. What happens when a new account does not say fresher or experienced. Proposed: it waits in the inbox for that one answer, as today.
4. Which past-due choice an automatic addition uses. Proposed: "ask the manager for the latest one only", the dialog's default.

A read-only count of which Microsoft 365 fields are filled was tried on 05-10-2026 and not run: it was blocked as handling personal data. Nothing was read.

### Plan — adding joiners automatically (not started; to be approved)

- **When:** at the end of each scan, for each account the rules offer as a joiner.
- **Added when all of these are known:** name and address (always), manager (no-manager accounts are already left out), project leader (from the Leaders list), date of joining (from Microsoft 365, or the day after the account was created), fresher or experienced (from Microsoft 365).
- **Otherwise:** it stays in the inbox, with the reason ("Microsoft 365 does not say fresher or experienced"), and HR answers the one missing question.
- **Recorded:** the candidate is marked accepted by `azure-sync`; the Commando's change history says it was added automatically and where the date of joining and fresher/experienced came from.
- **HR is told:** one notification per scan — "N new joiners added automatically" — with each name, date of joining and track, so a wrong one can be corrected with Edit (which moves the unsent evaluation dates) or Mark as left.
- **Switch:** a setting "Add new joiners automatically" (on / off), so it can be turned off without a deploy.
- **Test run:** shows who would be added and who would wait, without adding anyone.
- **Comment-out rule:** the "never creates an employee by itself" rule in `joinerIntake.service.js` and the inbox's accept-only path stay in the file as comments.

---

## 02-10-2026

### Summary

- Five open decisions were answered and built.
- 69 tracked files changed (+6,608 / −1,995 lines) and 11 new source files, counted from the last commit. Nothing is committed.
- Backend tests: 420 of 420 pass. The frontend builds.
- The scan's joiner pass was rehearsed against the tenant with the decisions in force, reading only. No real scan was run.
- A "Pending" section was added to this log (above).

### Decisions

| Decision | Answer | What it changed |
|---|---|---|
| New accounts with no manager in Microsoft 365 | **Leave out** | The setting now starts at "leave out". Such an account is not offered until it has a manager; one already waiting is taken off the inbox; the New joiners screen names them. |
| Follow `mera.work` and `karyakeeper.com` | **Follow** | All three domains are followed, for joiners and for the leaver check. |
| Is the Leaders-list chain the right project leader | **The Leaders list only** | The first person on the Leaders list at or above the reporting manager is the suggestion. Nothing else is. When the chain reaches nobody, no project leader is suggested and HR chooses. |
| Unlicensed accounts are never offered as joiners | **Yes** | Nothing. It stays as built: always on, not a setting. |
| Which email templates HR has edited on production | **None on production; only on staging** | Nothing to do on production. On staging, four templates are edited — see "Pending", section 4, Phase 3. |

### What changed

| Point | What changed | Commented out |
|---|---|---|
| H1 | The setting "Joiner email domains" starts at `aapnainfotech.com, mera.work, karyakeeper.com`. It is stored under a new key, `azure_email_domains`. | The one-domain default; the read of the old key. The old key is listed under "Not in effect" in Settings for a super admin. |
| H1 | "New accounts with no manager" starts at "leave out". The notice on New joiners says they appear on their own once Microsoft 365 has a manager for them. | The old default; the old notice wording. |
| U8 | The project leader is suggested from the Leaders list only. | The fallback to the map learned from the current Commandos (`derivePl`), and its import. |
| U8 | "Refresh project-leader suggestions" is removed from New joiners, and the notice "N reporting manager(s) have more than one project leader" with it. | The button, its mutation, its icon import, the notice. |
| U8 | "Next: rebuild the reporting-manager → project-leader map" and its "Rebuild map" button are removed from Upload sheet. | The alert, its mutation, its icon import. |
| U8 | Picking a manager in a form either fills in the leader from the Leaders list, or says nobody on the list is at or above that manager and asks HR to choose. | The two notes about the manager's other Commandos. |
| Settings | The help text of the Leaders list and the no-manager setting says what they now do. | — (wording) |

Why the domains have a new key: staging already stores `azure_email_domain = aapnainfotech.com`, and the build running there reads that row as one domain. A list saved into it would match no account, and that build treats "no accounts" as "everyone has left". With its own key, the list cannot be misread by the older build, before the deploy or after a rollback.

How "Leaders list only" was read: it decides where the **suggestion** comes from. HR can still type or pick any address as project leader. If the box should also refuse or warn about someone who is not on the list, that is decision 6 under "Pending".

### What the decisions do, measured on the tenant (02-10-2026, reading only)

| | Before | Now |
|---|---|---|
| Domains followed | 1 | 3 |
| Accounts read (enabled) | 340 (277) | 375 (307): `aapnainfotech.com` 342 (279), `mera.work` 28 (23), `karyakeeper.com` 5 (5) |
| Time for a scan's reads | about 15 seconds | about 17 seconds |
| On the Contractor list / the Leaders list | 10 / 10 | 10 / 10 — all on `aapnainfotech.com` |
| New accounts in the last 45 days, not already Commandos | 3 | 7 |
| … offered as joiners | 3 | 5 |
| … left out: no manager in Microsoft 365 | 0 (shown with "Missing") | 2 |
| Project leader for those offered | 2 from the Leaders list, 1 no manager | 5 of 5 from the Leaders list |
| Managers who reach someone on the Leaders list | 34 of 34 | 35 of 35 — so "Leaders list only" leaves nobody without a suggestion today |
| Waiting in the inbox now, and taken off by the next real scan | none | 1 of 2 — no manager |
| Enabled, licensed accounts with no manager, in all | — | 38. None is a joiner unless it is new. |

### Also found, reading only

- **Four email templates are edited on staging**: evaluation request, reminder, acknowledgement, manager's team link. They keep their own wording and will not show the new probation line (H8) until reset or edited.
- The Commandos on staging are test records on `mmaapnainfotech.com` and `gmail.com`. None is on a followed domain, so the leaver check finds none of them in Microsoft 365. That is expected for test data.

### Tests

| After | Backend `npm test` | Frontend build |
|---|---|---|
| The five decisions | 420 of 420 | Builds |

`adSync.test.js` has 51 tests (46 before). `adminFeatures.test.js` follows the renamed domain setting.

Not tested: a real scan with these rules; any of it in a browser.

---

## 01-10-2026

### Summary

- Planned the whole review round and built Phases 1 to 6.
- 68 tracked files changed (+6,551 / −1,983 lines) and 11 new source files. One of the 68, `DEPLOYMENT.md` moving into `docs/`, was already in the working tree and is not part of this work.
- Backend tests: 415 of 415 pass. The frontend builds.
- Nothing has been run against a database with the new DDL. The top bar and the Evaluations board were looked at in a browser (screenshots, with the API answered from saved data); no other screen was.
- Phase 5's list filters, sorting, manager list and export were run against the staging data, reading only. Phase 6's directory read, both lists and the scan's joiner pass were run against the tenant, reading only.
- Phase 6 reads the same two lists as the flow using the permission PEA already has, so the Contractor rule and the Leaders-list project leader are on. Domains and no-manager accounts are settings, left where PEA was before.
- The top bar and the Evaluations board were tidied up.
- Rule followed throughout: removed or replaced code stays in the file as a marked comment; nothing is deleted, no file is renamed. Plain wording edits (names, labels, date format) are edited directly.

### Planning and decisions

1. Read the review points and wrote the implementation plan.
2. Four open points settled:
   - **U10** — build separate "Record decision" and "Mark as left" actions.
   - **M8 "copy the ratings"** — a "Copy from evaluation N" button in HR's in-app entry, not on the manager's form.
   - **H4** — remove the work list, keep the email log.
   - **L7** — notes only; attachments wait.
3. Standing rule added: comment the code out, never delete it.
4. Work had started before a plan was approved. It was paused, the plan was rewritten per point (files and behaviour) and approved. The work already on disk was kept for review.
5. Pace agreed: one phase, then stop and report. No commits unless asked.
6. The Power Automate flow export for AD sync was provided and written up as Phase 6 (plan section 8a).
7. Go-ahead given for Phases 5 and 6 together. The four Phase 6 decisions were still open, so Phase 6 was built with each one as a setting rather than a fixed choice — see "Phase 6" below.
8. Permission settled: no new Microsoft 365 permission is to be asked for; PEA is to use what its app registration already has. That turned out to be enough — see "Phase 6", "The permission".
9. Asked for: the filter row above the status chips on the Evaluations board, a tidier board, and a tidier top bar.

### Phase 1 — HR's email and quick fixes

| Point | What changed | Commented out |
|---|---|---|
| B6 | The Commando's own view shows the real count of completed evaluations. | The old fixed line. |
| B7 | The button reads "Close this tab"; where the browser refuses, the page says to close it by hand. | Old markup, kept in the helper's comment. |
| B8 | The form says "HR reads these." unless the self-view setting shows comments to the Commando. | — |
| H2 | Trends shows the four figures and the per-person table only. | The "Overall trends" panel, its imports and helpers, and the old `getAnalytics()` with its five queries. |
| H3 | The board shows Average rating only. | Three figure buttons; three `stats` fields. |
| H4 | "Work list & emails" is now "Email log" at `/evaluations/emails`; the old address redirects there. | The work list component; `listEvaluations` and its helpers; `GET /api/evaluations`. |
| H5 | The evaluation page no longer has the "All seven ratings" panel. | `RatingsPanel`, `Dots`, `jumpTo`. |
| H6 / U4 | Every date reads dd-MM-yyyy: screens, date pickers, the manager's form, emails, notifications, the Excel export. APIs still use YYYY-MM-DD. | The old `formatDisplay`, `shortDate` and month table. |
| H7 | The name is "AAPNA Probation Period Evaluation Platform" in the tab, sidebar, sign-in page, manager and Commando pages, print header and emails. The "PEA" mark stays. | — (wording) |
| H9 | "Employee(s)" reads "Commando(s)" in everything a person sees. Routes, API, tables and `{{employee_name}}` are unchanged. | — (wording) |
| U7 | The Commandos search waits 350 ms after typing stops. | The old `onChange`. |
| U12 | Change history uses plain labels, one date format, and "Show all (N)". The history limit went from 50 to 500. | The old history block. |

### Phase 2 — Probation rule

Rule: a fresher has 6 evaluations and at most a 7th and 8th; an experienced joiner has 3 and at most a 4th and 5th. Each extension evaluation covers the 30 days after the previous period ends.

| Point | What changed | Commented out |
|---|---|---|
| B1 / M2 | A second extension covers the next month, not the same days again. | `EXTENSION_DAYS`, the old `buildExtensionSchedule`, the silent `seq_no <= 8` filter. |
| B2 | The form offers only the decisions still allowed and says why. A stale form that sends more is refused with a clear message. | The line that always sent all four options. |
| U10 + B3 | The Commando page has **Record decision…** (decision, reason, date) and, under More, **Mark as left…** / **Mark as active again…**. An extension recorded there schedules its evaluation. Edit no longer has those two dropdowns. | The two Edit fields; the old `confirmLeaver`. |
| U11 | The Commando page shows "Probation ends" and, once it is past with no decision, "Decision due — ended N days ago". | — |
| — | Settings no longer says "DOJ + 210 days". | Old wording noted in a comment. |

New routes: `POST /api/employees/:id/decision`, `/mark-left`, `/mark-active`.

### Phase 3 — Manager form and emails

| Point | What changed | Commented out |
|---|---|---|
| U1 | A sticky "4 of 7 answered" bar on the form. | — |
| U2 | A missing rating is linked from the summary and its question is marked. | — |
| U3 | Each question's options are a `<fieldset>` with a `<legend>`. | — |
| P10 | "Last time (Evaluation 2): 3 — Satisfied", with the comment, under each question. | — |
| P11 | "Save draft" and autosave (at most every 15 seconds). A draft opens on any device. The board card says "draft saved (date)". | The old submit handler. |
| H8 | Subjects read "Probation Evaluation 2 of 6 - Name"; bodies state the probation period and where the evaluation falls in it. New placeholders: `{{evaluation_of_total}}`, `{{evaluation_total}}`, `{{probation_start}}`, `{{probation_end}}`, `{{probation_line}}`. | The old default wording, in a comment block. |

New route: `POST /api/evaluation/:token/draft`, with its own rate limit (120 per 10 minutes).

### Tried and reverted

- **Compact redesign of the manager's form.** Asked for as "short and crisp, modern yet elegant"; built, then rejected. It was removed in full rather than commented out, because it was a rejected draft and never part of PEA. The form is the original green-banner design with the Phase 3 additions.

### Phase 4 — Who answered, and HR actions on one evaluation

| Point | What changed | Commented out |
|---|---|---|
| M3 / U13 | Changing a manager's email cancels the open links and emails new ones to the new manager. Edit warns before Save; the toast says how many went. A past evaluation shows who actually answered it; an open one shows who has the link. | The old `submit()`, the old `sendEvaluationNow` body, the old recipient rule, the old Save toast. Notes mark where `rmName` was replaced. |
| M7 | "Send to someone else…" on an open evaluation: that one evaluation goes to an acting manager, the real manager on CC. Reminders follow the acting manager. A plain Resend brings it back. | — (new) |
| M6 | "Reopen…" on the latest submitted evaluation, with a reason. The manager gets it back prefilled through a new "reopened" email. The earlier version is kept and shown. A decision it carried is taken back. | — (new) |
| P8 | "Record what was done" on a flagged evaluation: Spoke to the manager · Spoke to the Commando · Improvement plan started · No action needed · Other. Once recorded it leaves "Needs attention" for everyone. | The old attention card; the old attention rule noted. |
| B5 / U9 | Add, New-joiner accept and Resume-from-hold ask what to do with evaluations already past due: latest one only (default) · keep blank · I will enter them · all of them. | The old `setHalt` in the service and controller; the old hold click. |
| HR entry + M8 | "Enter ratings" on an evaluation that is not submitted: ratings required, comments optional, marked "entered by HR". "Copy from evaluation N" prefills from the previous one. | — (new) |

New routes: `POST /api/evaluations/:id/delegate`, `/reopen`, `/follow-up`, `/record`. `POST /api/employees/:id/halt` and the create and accept calls take `past_due_action`.

Where Phase 4 differs from the plan:

- "Send to someone else…" is on the evaluation page only, not also in the schedule row on the Commando page.
- A draft does not follow the link: when a link moves to another person, the previous holder's draft is discarded.
- There is no "Include handled" filter on the board. A recorded outcome shows on the evaluation page and in the change history.
- "Enter ratings" does not offer a decision; that stays with "Record decision…".
- An evaluation due today counts as past due.
- Every Phase 4 action is hidden, and refused by the API with a 503 and the reason, until the DDL is applied.

### Phase 5 — Commandos list and page

| Point | What changed | Commented out |
|---|---|---|
| U5 | The Commandos list has a **Status** filter — In probation · Extended · Confirmed · Not Confirmed · Paused · Held (may have left) · Left — and an **All managers** filter. A row Microsoft 365 has flagged shows "Held — may have left" under its status. | The old Status dropdown (decision only); the old filter code in `listEmployees`; the old Status column. |
| U6 | Name, DOJ, Reporting manager and Status sort by clicking the heading. **Export** downloads the list as the Excel workbook, with the same filters and the same order. | The two unsorted column definitions; the export's own two filters and its fixed order; the pager's own `onChange`. |
| U8 | Reporting manager, project leader and acting manager are picked from Microsoft 365 by typing a name. The email comes with the person. Picking a manager fills in the project leader, or says why it could not. Typing by hand still works. Used in Add, Edit, New-joiner confirm and "Send to someone else…". | — (the boxes were plain inputs; noted in a comment) |
| L7 | The Commando page has a **Notes** card: add a note, see who wrote each and when, delete your own (an admin can delete any). A deletion is recorded in the change history. Notes are not shown to the Commando, the manager, in a shared report or on a printout. | — (new) |

New routes: `GET /api/employees/managers`, `GET /api/employees/export`, `GET` / `POST /api/employees/:id/notes`, `DELETE /api/employees/:id/notes/:noteId`, `GET /api/directory/people`, `GET /api/directory/project-leader`.

Where Phase 5 differs from the plan:

- The manager filter has its own query, not the board's `managerOptions()`. The board lists managers of people still here; this list can also show people who left.
- A status or sort column the API does not know is refused with a 400, not ignored.
- "In probation", "Extended", "Confirmed", "Not Confirmed", "Paused" and "Held" all mean someone still here. A person who has left shows under "Left" only.
- Sorting by "Next due" is not offered, as the plan said.
- Notes are read with their own call (`/employees/:id/notes`), not inside the Commando record, so nothing that reads the record can pass them on.
- The Notes card is not shown until the DDL is applied; adding a note then is refused with a 503 and the reason.
- A note is limited to 4,000 characters and cannot be edited.
- The people picker offers enabled, licensed accounts that are not system mailboxes (152 today). The first search after ten idle minutes takes about four seconds while the directory is read; after that it is immediate.
- When Microsoft 365 cannot be reached the picker says so and the box is a plain text box. It retries once a minute, not on every keystroke.

### Phase 6 — AD sync from the MRA Reconcile flow

Built from the flow's rules. Each rule is a setting under **Settings → New joiners**.

| Point | What changed | Commented out |
|---|---|---|
| H1 | The New Joiner Inbox is offered only accounts that are enabled, have an address on an allowed domain, have a licence, are not a system mailbox, are not on the excluded list and are not on the Contractor list. What a scan left out is counted and shown: "left out: 2 contract staff, 1 no Microsoft 365 licence". | The single-domain read and its `DEFAULTS` entry; the old scan message. |
| H1 | Someone already waiting in the inbox who is contract staff, a system mailbox or on the excluded list is taken off it with the reason. They come back on their own if the rule stops applying. Someone a person dismissed never comes back. | — (new) |
| H1 | Several domains can be followed, not one. | The one-domain setting entry. |
| U8 | The manager is read with the account, in one request for everyone, in place of one request per new account. | `getManager`, `fetchManagers`, `listAccounts`, `graphGetAll` in `entraDirectory.service.js`. |
| U8 | The project leader suggested is the first person on the Leaders list at or above the reporting manager, six people up at most. When the chain finds nobody, or no Leaders list is set, the map learned from the current Commandos answers, as before. The screen says which of the two supplied it. | The direct `derivePl` import and call; the fixed `'rm_map'` source. |
| Safety | The check stops and changes nothing if the account read comes back empty or cut short, or — while a list is set — it cannot read which lists an account is on, or finds nobody on the list. The existing "Microsoft 365 check failed" alert tells HR why. | — |
| Settings | New: Joiner email domains (a list) · Contractor list id · Leaders list id · Never offer these as joiners · System mailboxes · New accounts with no manager (show / leave out). | — |
| Diagnostics | The directory check also confirms PEA can read which lists an account is on. The New joiners screen shows the reason when the directory cannot be read, and says when the Contractor list has been cleared. | The old return value of `verifyDirectoryAccess`. |

How the four open decisions were built:

| Decision | Built as | Set to |
|---|---|---|
| People with no manager in Entra | Setting "New accounts with no manager": show / leave out | **show** — PEA's way, unchanged |
| Domains | Setting "Joiner email domains", a list | **aapnainfotech.com** only — unchanged |
| Permission for the two lists | Not needed. PEA reads the lists another way, with `User.Read.All`, which it already has. | Both lists **on**, at the flow's ids |
| Leaders-list chain walk | Used while the Leaders list id is set | **On**, as the flow does it. HR confirms the project leader for each joiner. |

#### The permission

- The flow and PEA sign in to Microsoft 365 as two different app registrations. The flow is `3dc7c91e-…`. PEA is `6dc40383-…` ("HR_RPA").
- The flow reads each list with `GET /groups/{id}/members`. Its registration is allowed to.
- PEA's registration has `User.Read.All` and no group permission. The flow's two list calls, made by PEA exactly as the flow makes them, come back **403**.
- Decision (Harish, 01-10-2026): no new permission is to be asked for.
- So PEA asks the same question from the other end: for each enabled account, `GET /users/{id}/memberOf` — "which lists is this account on?". That needs only `User.Read.All`. Graph answers with each list's id, which is all that is wanted.
- The result is the same two sets of people. Measured: 10 enabled accounts on `aapnainfotech.com` are on the Contractor list and 10 on the Leaders list.
- The cost is one request per enabled account instead of one per list: about 280 requests and 12 seconds per scan. The answers are kept for ten minutes. A form asking for one manager's project leader asks only about the six people on that manager's chain.
- What PEA cannot do with this permission is look a list up by its id. A mistyped id therefore shows as "nobody is on the list", and the check stops and says so.

Commented out for this: `listGroupMembers` in `entraDirectory.service.js` and the first `readList` / `readLists` in `directory.service.js` (the flow's own call, written first and found not to be permitted), and the blank defaults for the two list ids.

To switch a rule off: clear its list id in Settings → New joiners.

Where Phase 6 differs from the plan:

- The lists are read per account (`/users/{id}/memberOf`), not per list (`/groups/{id}/members`) as the flow reads them.
- A list nobody is on stops the check, where the plan said "comes back empty". It is the same guard, and it also catches a wrong id.
- The licence rule and the system-mailbox rule are always on: 125 enabled accounts on `aapnainfotech.com` have no licence today and would no longer be offered if created in the last 45 days.
- "No manager" follows a setting; the plan asked it as a question.
- An account with only a sign-in name (no mail address) still counts, as it always has in PEA. The flow requires a mail address.
- Unlicensed, disabled and off-domain accounts already waiting in the inbox are left there. Only contract staff, system mailboxes, excluded addresses and (when "leave out" is chosen) no-manager accounts are taken off.
- A member of a list is matched by Entra id as well as by address.
- The leaver check is unchanged, except that it now covers every allowed domain and never runs on an empty read.

What was measured on the tenant, 01-10-2026, reading only:

| | |
|---|---|
| Accounts on `aapnainfotech.com`, read with managers in one request | 340, complete, about 4 seconds |
| Enabled | 277 |
| Enabled with a manager | 122 |
| Enabled but unlicensed | 125 |
| Accounts on `mera.work` / `karyakeeper.com` | 28 / 5 |
| The flow's list call (`/groups/{id}/members`) made by PEA | 403 for both lists |
| Reading which lists each of the 277 enabled accounts is on | Works with `User.Read.All`; no failures; about 12 seconds |
| On the Contractor list / on the Leaders list | 10 / 10 |
| Would count as a joiner if new | 142 (152 before the Contractor list is applied) |
| New accounts in the last 45 days that are not already Commandos | 3 — all three would be offered |
| Project leader for those three | 2 from the Leaders list · 1 has no manager in Microsoft 365 |
| Managers who reach someone on the Leaders list within six people | 34 of 34 |
| Waiting in the inbox now, and taken off by the rules | 2 waiting, none taken off |

### Top bar and Evaluations board tidy-up

Asked for on 01-10-2026; not a review point.

| Where | What changed | Commented out |
|---|---|---|
| Top bar | The initials sit inside the avatar again, and the menu button's icon is centred. Both were pushed out of place by a line height of 64px that the bar inherited. | — (the rule is overridden; the earlier rules are left as they were) |
| Top bar | Every control is the same height with the same corner. "No email is being sent" is a pill in the app's own warning colours. The bell and theme switch sit together, with a hairline before the Admin Portal button and the account chip. The unread count sits on the bell. | The antd `Tag`, and its import. |
| Top bar | The account chip is avatar, name over role, and a caret. It is a button, so it can be opened from the keyboard. | The old chip markup. |
| Sidebar | "Probation Period Evaluation Platform" is on two even lines in sentence case, in place of three rows of spaced capitals. | — (overridden) |
| Evaluations board | The filter row is above the status chips. The two are one toolbar. | — (moved; a comment marks it) |
| Evaluations board | Cards / Table and Email log are at the right of the filter row. Email log is an outlined button. | The `type="text"` note. |
| Evaluations board | "Needs attention" stands apart at the right end of the chips. | — |
| Evaluations board | Average rating is a small card ("3.43 / 5") beside the heading, in place of a wide box with one number in its corner. | The old figure markup. |
| Evaluations board | The ratings key is a quiet line of its own, with the number of evaluations at its right. | — |
| Evaluations board, table | The Submitted date stays on one line. | The old 100px column. |

Phone widths: the warning shows its icon only, the account chip its avatar only, and the filters stack with the view switch below them.

These were checked in a browser at 1600px, 1100px and 420px, in the light and dark themes, in the card and table views. The top bar is shared by every screen; only the board was looked at.

### Database

`backend/prisma/ddl/2026-10-02-pea-review-round.sql` — one transaction, additive, re-runnable. **Not applied anywhere.**

| Object | For |
|---|---|
| `pea_employees.decision_on`, `decision_reason`, `decision_by`, `left_on`, `left_reason` | U10 |
| `pea_evaluation_cycles.draft`, `draft_saved_at` | P11, M6 |
| `pea_evaluation_cycles.sent_to_name`, `sent_to_email`, `delegated`, `submitted_by_name`, `entered_by` | M3, M7, U13, HR entry |
| `pea_evaluation_revisions` | M6 |
| `pea_evaluation_followups` | P8 |
| `pea_email_log_type_chk` gains `evaluation_reopened` | M6 |
| `pea_employee_notes` | L7 |

Phase 6 needs no DDL. Its settings are rows in `pea_settings`, created the first time each is saved.

### New files

| File | What it is |
|---|---|
| `backend/prisma/ddl/2026-10-02-pea-review-round.sql` | The database changes above. |
| `backend/src/services/evaluationActions.service.js` | Send, re-send on manager change, delegate, reopen, follow-up, HR entry. |
| `backend/src/tests/reviewRoundPhase4.test.js` | 25 tests for the Phase 4 rules. |
| `frontend/src/components/EvaluationActions.jsx` | The dialogs for delegate, enter ratings, reopen and follow-up. |
| `frontend/src/components/PastDueChoice.jsx` | The past-due question used on Add, New-joiner accept and Resume. |
| `backend/src/services/directory.service.js` | The directory rules and their settings, the two lists, the Leaders-list chain, and the people search. |
| `backend/src/routes/directory.routes.js` | `GET /api/directory/people` and `/project-leader`. |
| `backend/src/tests/reviewRoundPhase5.test.js` | 32 tests for the Phase 5 rules. |
| `backend/src/tests/adSync.test.js` | 46 tests for the Phase 6 rules. |
| `frontend/src/components/PersonPicker.jsx` | The people picker, and what picking a manager fills in. |
| `frontend/src/components/EmployeeNotes.jsx` | The Notes card on the Commando page. |
| `docs/PEA-implementation-plan.md` | The plan, with status and Phase 6. |
| `docs/PEA-change-log.md` | This file. |

### Tests

| After | Backend `npm test` | Frontend build |
|---|---|---|
| Phase 2 | 292 of 293 — the one failure needed the staging database, which was unreachable at the time | Builds |
| Phase 3 | 309 of 309 | Builds |
| Phase 4 | 337 of 337 | Builds |
| Phases 5 and 6 | 408 of 408 | Builds |
| Lists read per account; top bar and board tidy-up | 415 of 415 | Builds |

Also checked for Phases 5 and 6, reading only:

- Every route loads. The seven status filters, the eight sort orders, the manager filter, the manager list and the filtered export ran against the staging data (4 Commandos).
- The directory read, both lists, the "who counts" rule, the project-leader chain and the directory diagnostics ran against the tenant, as the scan's joiner pass would run them but saving nothing. The result is in the Phase 6 table above.

Not tested: a real scan (it writes a row to the scan log, so it was rehearsed and not run) — in particular a contractor already waiting being taken off the inbox, and the check stopping when a list id is wrong. Any screen other than the board in a browser. Anything against a database with the DDL applied — so a note has never actually been saved. The staging checklist is in the plan, section 10.

`npm run lint` does not run: the backend has no ESLint configuration file.

### Outside the source files

- `npm ci` in `backend/` and `frontend/`, and `npx prisma generate`, to run the tests and the build. `node_modules` only.
- Check builds went to a scratch folder, not `frontend/dist`.
- Read-only check scripts were run from the temp folder and deleted. Some read the staging database (`SELECT` only). The others made `GET` requests to Microsoft Graph with PEA's own credentials and printed counts and permission names only — never a secret, a token, a name or an address. Nothing was written to the database, no scan was recorded, no email was sent. The flow's client secret was not used.
- For the screenshots, the frontend's dev server was run on a spare port and stopped afterwards, with every API call answered from a saved copy of the staging board. No backend was started.

### Open risks

- **The flow export holds a secret.** `MRAReconcile-v3-C7D5B118-8CAB-F111-AAAB-7CED8DBA44E7.json` in the repo folder contains the Entra app registration's client secret in plain text, three times. It is untracked and not in `.gitignore`. Do not commit it; rotate the secret if the file has been shared.
- **Excel export dates are text.** They read dd-MM-yyyy. If an export were ever re-imported, `05-03-2026` would be read as 3 May. Nothing reads the export back today.
- **Templates HR edited keep their own wording.** H8 changes only the defaults. An edited template needs `{{probation_line}}` added by hand, or a reset.
- **A new joiner with no licence yet is not offered.** They appear on the first scan after IT assigns the licence, as long as that is within the look-back window (45 days). Someone licensed later than that has to be added by hand.
- **While a list id is set, a list that cannot be read stops the whole check**, leaver check included. That is the flow's guard and it is deliberate. It means that if everyone is ever taken off the Contractor list, or the list is replaced by a new one with a new id, the check reports "the Microsoft 365 check failed" every night until the id in Settings is corrected or cleared.
- **The scan now makes about 280 more requests to Microsoft 365**, one per enabled account, and takes about 15 seconds in place of 4. No request failed when measured. If Microsoft 365 slows PEA down, each request is tried once more, and a request that still fails stops the check with the reason.
- **Contract staff on another domain are not seen.** Only accounts on the domains PEA follows are asked which lists they are on. That is enough for the inbox, which only offers accounts on those domains.
- **Link generation asks for 500 Commandos; the list gives at most 200.** `ManagerLinks.jsx` sends `limit: 500` and `listEmployees` caps it at 200. Seen while reading, not changed. It matters once there are more than 200 Commandos.
