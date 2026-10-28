# AAPNA PEA: user guides

PEA (the Probation Period Evaluation Platform) runs the probation evaluations of everyone who joins AAPNA. It emails each reporting manager an evaluation form when one is due, chases them, collects their ratings and comments, and records the confirmation decision at the end. It replaces the Excel master sheet, Microsoft Forms and the Power Automate flows.

These are step-by-step guides for the people who use it. No technical knowledge is needed.

| Guide | For |
|---|---|
| [HR guide](01-HR-GUIDE.md) | The HR team, every day: the Dashboard, evaluations, Commandos, new joiners, links, reports |
| [Admin guide](02-ADMIN-GUIDE.md) | Admins: users, module access, settings, email templates, the Excel import, sent emails |
| [Super Admin guide](03-SUPERADMIN-GUIDE.md) | Super Admins: managing admins and other Super Admins, deleting accounts |
| [For managers and Commandos](04-MANAGERS-AND-COMMANDOS.md) | Reporting managers, acting managers, project leaders, Commandos and the HR review mailbox. None of them need a PEA account |

---

## Who can do what

PEA has three kinds of account. An admin decides which one you have, and can switch individual screens on or off for HR users.

| Account | Can |
|---|---|
| **Super Admin** | Everything an Admin can, plus manage admins and other Super Admins, and delete accounts |
| **Admin** | Everything in PEA: all screens, the **Admin Portal** (users and module access), change settings and email templates, run the Excel import, read **Sent emails**, delete a Commando |
| **HR** | The screens an admin has switched on for them. On those screens HR can do the daily work: send and chase evaluations, record decisions, confirm new joiners, share reports. HR can **read** Settings and Email templates but not change them |

Some people never sign in. **Reporting managers** fill in the evaluation form from a link in their email, and can open a "my team" page. **Project leaders** are copied on the emails. **Commandos** can be given a link to see their own progress. See [For managers and Commandos](04-MANAGERS-AND-COMMANDOS.md).

Everyone with an account can change their own password: click your name (top right) → **Change Password**, or use **Forgot password?** on the sign-in page.

---

## Words used in PEA

| Word | Meaning |
|---|---|
| **Commando** | Someone whose probation PEA tracks: a new joiner on probation |
| **Fresher / Experienced** | The two probation tracks. A **fresher** gets **6** evaluations, one every 30 days. An **experienced** hire gets **3**, one every 60 days. Both last 6 months |
| **Evaluation** | One rating of one Commando by their reporting manager, covering the period since the last one. "Evaluation 2 of 6" |
| **Final evaluation** | The last evaluation of the probation. It also asks the manager for the **confirmation decision** |
| **Confirmation decision** | **Confirmed**, **Not Confirmed**, **Extend for 1 month** or **Extend for 2 months** |
| **Extension** | Extra evaluations after an "Extend" decision, 30 days apart. A probation can never run past **8 months** (at most two extension evaluations) |
| **Reporting manager (RM)** | The person who receives and fills in the evaluation form |
| **Acting manager** | Someone HR sends **one** evaluation to while the reporting manager is away |
| **Project leader (PL)** | Copied on every evaluation email for their Commando |
| **Date of joining (DOJ)** | The date the schedule is counted from. For someone found in Microsoft 365 it is suggested from the date their account was created |
| **Microsoft 365 check** | PEA's daily look at the company directory: it finds new accounts (new joiners) and accounts that look like leavers |
| **Archived** | A Commando whose probation is over. Kept in full, read-only, out of the day-to-day lists |

### Rating scale (what managers see)

| Rating | Meaning |
|---|---|
| **5 — Exceptional** | Sets new standards of performance |
| **4 — Highly Satisfied** | Always exceeds expectations |
| **3 — Satisfied** | Sometimes exceeds expectation |
| **2 — Dissatisfied** | Sometimes meets expectations |
| **1 — Highly Dissatisfied** | Needs development |

Every evaluation has the same **seven questions**: Quality of Code / Work, Meeting Deadline, Communication & Presentation, Proactiveness, Skill Development, Cultural Fit, X-Factor. A comment is required on every question.

On screen, ratings are coloured **red** for 1–2, **blue** for 3 and **green** for 4–5. An average is coloured by its nearest whole number.

### Evaluation statuses

| Status | Meaning |
|---|---|
| **Scheduled** | Not due yet. PEA emails the reporting manager automatically on the due date |
| **Waiting for manager** | The link has been emailed; the manager has not opened it yet. Reminders go out automatically |
| **Opened by manager** | The manager has opened the link but not submitted it |
| **Submitted** | The manager has submitted. Ratings and comments can be read |
| **Not sent yet** | The due date has passed but the email has not gone. Something needs fixing (open it to see why) |
| **Closed** | No longer needed, so it will not be sent. For example, the probation was decided before it fell due |
| **Needs attention** (flag) | A submitted evaluation to read closely: not confirmed, extended, an average below 2.5, or a question rated 2 or lower |

Hover over any status chip in PEA and it explains itself.

### How the year runs, in one paragraph
A new joiner is confirmed (from the New joiners screen, the review email, or by adding them by hand) → PEA works out their evaluation dates → on each due date, at the daily email time (11:00 by default), the reporting manager is emailed a form, with the project leader and the CC list copied → if the manager does not submit, reminders go 2 and 4 days later → when they submit, HR is notified and the ratings appear on the board → the final evaluation carries the confirmation decision → once the probation is decided, the Commando is archived the next morning.

Due dates that fall on a Saturday or Sunday move to the Monday.

---

## When something goes wrong
- If PEA shows an error, note **what you were doing**, **the screen**, **the time** and **the exact message**, and send them to the PEA team.
- The top bar shows **No email is being sent** when PEA cannot send email (for example, email is paused in Settings). Hover over it to see why. Tell an admin straight away: it means managers are not being asked for evaluations.
- On any screen with a list, a refresh of the browser page loads the latest data.

---

## About these guides
- They describe PEA as it stood on **28 October 2026**, after the HR walkthrough changes and before the production go-live. Screens change with each release, and the guides are updated with them.
- Outside production (on staging), every email PEA sends goes to a test inbox, never to real managers. In production, every email comes from **hr2@aapnainfotech.com**.
- To share a guide outside the PEA team, use the Word or PDF copy in the `exports` folder. How those copies are made is in [tools/README.md](tools/README.md).
