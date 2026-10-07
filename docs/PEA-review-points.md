# PEA — review points

Under each point, write your answer: **Fix now / Later / Won't do**, plus any notes.

---

## A. Bugs

### B1. A second extension gets the wrong date
Extension dates are always 210 and 240 days from joining. If a manager extends again at an extension evaluation, the new one is dated 210 days again — already past — so it is emailed the next morning and covers the same period twice.
File: `backend/src/services/cycleGenerator.service.js:42`

**Answer: Let's propose a plan and fix it.**

### B2. Extending at evaluation 8 schedules nothing
Anything past evaluation 8 is dropped, but the form still offers "Extend". The employee is left "Extended" with no evaluations, and the manager is told a new link will come.
File: `backend/src/services/cycleGenerator.service.js:163`

**Answer:** Form should not extend post extend 2 months. Let's Candidate A -Fresher is in 6th month, then it can extend max to 8th months only (6+2). If candidate B - exp (3), is in 6th month, then it can also extend for 8th month only (3+2).

### B3. An extension recorded by HR creates no evaluations
Choosing "Extend for 1 month" in Edit only saves the status. Only Confirm and Not Confirm trigger any follow-up.
File: `backend/src/services/employee.service.js:294`

**Answer:** If "Extend for 1 month" is selected, then the evaluation should continue the process for 1 more month and then asks confirm, not confirm and extend for 1 month (this time extend for 2 more months should not exist)

### B4. The wrong manager gets credit after a manager change
The submitter is always recorded as the current manager, and every past evaluation shows the current manager as "answered by". The old manager's open link still works, and their submission is credited to the new one.
Files: `backend/src/services/evaluation.service.js:287`, `backend/src/services/evaluationBoard.service.js:389`

**Answer:** That's fine, we can ignore. We can track the rating given by manager until the respective evaluation and for the forth coming, the new manager data will be logged or used.

### B5. Late additions trigger a burst of forms
Adding someone who joined months ago puts every evaluation in the past, and the next day's run emails all of them to the manager at once. Same after resuming someone from a long hold. (The Excel import handles this; Add employee and New-joiner accept don't.)
File: `backend/src/services/employee.service.js:212`

**Answer:** It won't happen after streamlining, but, in case if happens - then, it should be asking the user what should we do, add the scores & feedback manually or keep it blank or some other best option.

### B6. Employee view always shows "0 of N evaluations completed"
It counts `'Completed'` but the API sends `'Submitted'`.
File: `frontend/src/pages/SelfView.jsx:63`

**Answer:** Let's fix it.

### B7. "Close This Window" button does nothing
The page's security policy blocks the button's code, and browsers won't close a tab opened from an email anyway.
File: `backend/src/views/evaluationForm.js:642`

**Answer:** Let's add functionality and update the message as close this tab if the button fails.

### B8. Form tells managers the employee will read their comments
The form says "<name> sees these, and so does HR", but with the default setting (`averages`) the employee never sees comments.
File: `backend/src/views/evaluationForm.js:484`

**Answer:** Let's update the messgae then.

### B9. Manager portal shows "Extend…" in red
Shown the same as Not Confirmed.
File: `frontend/src/pages/ManagerPortal.jsx:98`

**Answer:** That's fine.

---

## B. Missing features — must-have before go-live

### M1. HR approval before a decision takes effect
The manager's choice (including "Not Confirmed") goes onto the employee record immediately. Usual chain: manager recommends → project leader / head of department agrees → HR approves → letter issued.

**Answer:** This hierarchy is not part of current requirement, let's remove it/park it. don't implement.

### M2. Limit on extensions
At the last allowed evaluation, offer only Confirm or Not Confirm. Date extensions from the last due date, not from the joining date. What is the maximum total probation?

**Answer:** Fresher - 6 evaulations in 6 months +7th in 7th month + 8th in 8th month ; Experience - 3 evaulations in 6 months +4th in 7th month + 5th in 8th month. Post 8th month - no resource will be extended. In future, it may.

### M3. Handling a change of manager
Send open links to the new manager, cancel the old ones, and record who actually submitted.

**Answer:** Yes. Old saved records should show the old manager and current one with new manager.

### M4. Leave during probation
Long leave (maternity, medical, unpaid) normally extends probation. Hold only pauses, and the end date never moves. Add "pause and move the dates by N days".

**Answer:** Park it. As of now, long leave is excluded . If resource leaves, then removing it from the list, we save the history but no further emails to their manager.

### M5. Skip or close one evaluation
HR can only hold all evaluations for a person, not skip a single one (with a reason).

**Answer:** No Skips required at this stage.

### M6. Reopen a submitted evaluation
If a manager makes a mistake there is no way to correct it. Add reopen with reason, keeping a record of the change.

**Answer:** Good addition. Let's do it. 

### M7. Send the link to an acting manager
When the manager is on leave, allow HR to send the form to a delegate.

**Answer:** Good addition. Let's do it.

### M8. Escalation after the last reminder
After reminder 2 nothing further is sent automatically, and the link expires after 30 days. Escalate to project leader → HR → manager's manager?

**Answer:**Not required. Let's mark the reminders frequency based on the HR (through APP). I think, HR manually updates the same. Also, copy the ratings is a good addition to the evaluation (only available from the app.)

---

## C. Missing features — important

### P1. Letters
Confirmation, extension and non-confirmation letters from templates, emailed to the employee and kept on the record.

**Answer:** No email to employee is sent at aany point of time. Out of scope for this project.

### P2. Emails to the employee
The employee is never emailed — no schedule at start, no notice when an evaluation is done, no decision. HR also has to copy the employee's view link and send it by hand.

**Answer:**Not required. Out of scope.

### P3. "Feedback discussed with the employee on ___" field
A field on the manager's form to confirm the feedback was discussed.

**Answer:**Not required. Out of scope.

### P4. Employee acknowledgement
The employee acknowledges each evaluation, with room to comment or disagree.

**Answer:**Not required. Out of scope.

### P5. Employee self-assessment
The employee rates themselves before the manager does.

**Answer:**Not required. Out of scope.

### P6. Goals at the start of probation
Set goals / KRAs at the start and show them on each form.

**Answer:**Not required. Out of scope.

### P7. Improvement plan for low ratings
"Needs attention" flags the problem, but there is no owner, target, review date or outcome.

**Answer:**Not required. Out of scope.

### P8. Record of what HR did about flagged feedback
Today there is only a per-person "read" mark. Record an outcome, e.g. "spoke to the manager", "improvement plan started", "no action".

**Answer:**Good addition.

### P9. Early confirmation or early termination
A decision can only be made at the final evaluation.

**Answer:**That was the requirement. Let's not change. 

### P10. Previous evaluation on the manager's form
Show last time's ratings and comments so the manager rates progress.

**Answer:** Good addition.

### P11. Save as draft on the form
Seven required comments; closing the tab by accident loses everything.

**Answer:** Propose. Good addition.

---

## D. Missing features — later

### L1. Probation length and frequency set per person
For interns, contract staff, three-month roles. Today only fresher (every 30 days × 6) and experienced (every 60 days × 3), fixed in code.

**Answer:**Not required now. Park it for later. 

### L2. Screen to edit the evaluation questions, and question sets by role
Questions are stored in the database but there is no screen for them.

**Answer:** Not required now. Park it for later. 

### L3. More fields on the employee record
Employee code, designation, department, location, probation end date.

**Answer:** Not required now. Park it for later. 

### L4. Public holiday calendar
Due dates skip weekends but not holidays.

**Answer:** Not required now. Park it for later. 

### L5. Microsoft sign-in for HR users
HR currently has separate PEA passwords.

**Answer:** Not required now. Park it for later. 

### L6. Move a whole team to a new manager at once

**Answer:** Not required now. Park it for later. 

### L7. HR notes and attachments on an employee

**Answer:** Good addition.

### L8. Advance "evaluation coming up" email to managers

**Answer:** Not required now. Park it for later. 

---

## E. UI/UX changes

### U1. Manager form — show progress ("4 of 7 answered")

**Answer:** Good addition.

### U2. Manager form — a missing rating isn't linked or highlighted
Missing comments are; missing ratings are not.

**Answer:**Good addition.


### U3. Manager form — rating options need grouping for screen readers

**Answer:**Good addition.


### U4. One date format everywhere
Employees list shows `2026-09-12`, most screens show `12-Sep-2026`, change history and employee view use the browser's format.

**Answer:**Good addition.


### U5. Employees list — more filters
Paused, Left, Held (may have left), and by manager.

**Answer:** Good addition.

### U6. Employees list — sortable columns and export

**Answer:** Good addition.


### U7. Employees list — search sends a request on every keystroke
Wait until typing stops.

**Answer:** Good addition.


### U8. Add / Edit employee — pick manager and project leader from the directory
Today they are typed by hand. Prefill the project leader from the existing manager → project leader mapping.

**Answer:** Good addition. I have already fixed AD sync through a flow (separate automation) I will share the flow, you can fix the AD sync.

### U9. Add employee — warn when the joining date is in the past
"3 evaluations are already past due — send them, or close them as history?" (Related to B5.)

**Answer:** Good addition.


### U10. Separate "Record decision" and "Mark as left" from general Edit
Each with a reason and date. Today one dropdown can end a probation with no reason.

**Answer:** Good addition.

### U11. Employee page — show "Probation ends / decision due by" at the top

**Answer:** Good addition.


### U12. Employee page — readable change history
Shows database field names (`rm_email`, `halt_process`) and stops at 20 entries. Use labels and add "Show all".

**Answer:**Good addition.


### U13. Evaluation page — show who really submitted
(Related to B4. Reopen / Skip / Reassign actions are M5–M7.)

**Answer:**Good addition.


### U14. Manager portal — let managers read their own past answers
Today they see only the average.

**Answer:** Not required now.

### U15. Manager portal — "doesn't report to me any more" button that alerts HR

**Answer:**Not required now.

---

## F. HR feedback — 29-09-2026

From Subhajit Maiti (HR), email "Required Changes – AAPNA Probation Period Evaluation Platform". Screenshots in the email are described in the point they belong to.

### H1. Fetch only Interns and Permanent AAPNAite's from AD, with no manual checking
The New Joiner Inbox brings in every new Microsoft account — Interns, Contractual Resources and Permanent AAPNAite's — and HR has to check each one by hand. HR wants Interns and Permanent AAPNAite's fetched automatically, and contract staff left out.
Blocker: AD does not say who is an intern, contract or permanent (`employeeType` is empty for everyone), so PEA cannot filter on it today. (Related to U8 — your AD sync flow.)
Files: `backend/src/services/joinerIntake.service.js:18`, `frontend/src/pages/NewJoiners.jsx`

**Answer:** I will give a solution, for the same through a power automate flow - where I have solved this.

### H2. Remove five Analytics sections
Manager Comparison, Average by Parameters, Rating Distribution, Average Rating by Month, Probation Outcome. All five sit in the "Overall trends" panel.
File: `frontend/src/pages/Analytics.jsx:173`

**Answer:**Let's do it.

### H3. Remove duplicate figures from the dashboard
The Evaluations board shows Submitted, Waiting for manager and Need attention twice: once in the figures at the top, and again as counts on the status chips just below.
File: `frontend/src/pages/EvaluationBoard.jsx:189` (figures), `:210` (chips)

**Answer:** Let's do it.


### H4. "Work list & emails" — explain it or remove it
HR asks what it is for. It is the previous evaluations list: outstanding evaluations grouped by manager, plus a log of every email PEA has sent. HR is waiting for a reply on this one.
Files: `frontend/src/pages/EvaluationBoard.jsx:281` (link), `frontend/src/pages/Evaluations.jsx`

**Answer:** See if it is required and making sense. otherwise, let's remove it.

### H5. Remove the Rating section
The screenshot shows the "All seven ratings" panel on the evaluation page (Quality, Deadlines, … X-Factor). The same ratings still appear against each question lower down.
File: `frontend/src/pages/EvaluationProfile.jsx:159`

**Answer:** Let's remove it.

### H6. One date format everywhere — HR suggests DD-MM-YYYY
The screenshot shows the Employees list with DOJ and Next due as `2026-08-16`. Most other screens already use `16-Aug-2026`; HR's example is `16-08-2026`. Pick one. (Same as U4.)
Files: `frontend/src/pages/Employees.jsx:79`, `frontend/src/formatDate.js:39`, `frontend/src/pages/EmployeeDetail.jsx:759`, `frontend/src/pages/SelfView.jsx:157`

**Answer:** The one finalized by HRD - dd-MM-yyyy.

### H7. Rename the app to "AAPNA Probation Period Evaluation Platform"
Today it is "Performance Evaluation — AAPNA" in the browser tab, "AAPNA / Evaluation Platform" in the sidebar and sign-in page, and "AAPNA PEA — Evaluation Platform" in account emails.
Files: `frontend/index.html:7`, `frontend/src/App.jsx:154`, `frontend/src/components/AuthShell.jsx:13`, `backend/src/services/accountEmail.service.js:54`

**Answer:** Let's do it.

### H8. Mention the probation period in every email
The manager emails (Evaluation request, Reminder) say "performance evaluation" and never mention probation or where the person is in it. HR wants each email to state the probation timeline.
File: `backend/src/services/emailTemplate.service.js:115`

**Answer:** Let's do it.

### H9. Replace "Employees" with "AAPNAite's" or "Commandos"
About 140 places across 22 screens, plus email text. HR offered both terms — pick one.

**Answer:** Let's update with commandos.
