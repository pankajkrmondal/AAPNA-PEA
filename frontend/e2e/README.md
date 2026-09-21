# End-to-end tests

Browser tests for the eight screen changes from the 18-Sep review. They drive
the real app against the real backend and database.

## Running them

Both servers must already be running — the suite does not start them, because
starting only half of the stack produces tests that pass against an empty
screen:

```bash
cd PEA-Local/backend  && npm run dev     # terminal 1
cd PEA-Local/frontend && npm run dev     # terminal 2
cd PEA-Local/frontend && npm run test:e2e   # terminal 3
```

First time only:

```bash
npx playwright install chromium
cp .env.e2e.example .env.e2e     # then fill in the passwords
```

`npm run test:e2e:ui` opens the interactive runner; `npm run test:e2e:report`
shows the HTML report after a failed run.

## Credentials

`.env.e2e` (gitignored) holds one account per role. The suite wants three
because four of its tests exist to prove that a super admin sees things an
admin and an HR user do not.

**A role with no password is skipped, not failed.** With only the super admin
filled in the suite still runs and still passes — but the negative half of the
role gating is not verified, and `global-setup` prints a warning saying so.
Don't read a green run as complete until that warning is gone.

## What is covered

| Spec | Review points | What it asserts |
|---|---|---|
| `navigation.spec.js` | 2, 8 | Sidebar says "Dashboard"; "Upload sheet" sits directly after "Link generation" and opens the standalone page |
| `settings.spec.js` | 1, 3, 4, 5 | No environment banner; no "needs restart"; saving the sweep cron returns `applied: true` and an invalid one is refused; DB keys and the "Not in effect" tab reach a super admin only, checked in the browser *and* in the API payload |
| `notice-strip.spec.js` | 6, 7 | The banner stacks are gone; the strip stays near one line, expands to the full wording, and collapses again; the two New joiners tables sit close together; "Issued links" is above the fold |

## Things worth knowing before you change these

**Sign-in is cached per role.** `/auth/login` is rate limited to 10 attempts
per 15 minutes. Calling `signIn()` in a `beforeEach` across a dozen tests trips
it and every later test fails with a confusing 429. `helpers.js` logs in once
per role and reuses the token; add tests the same way. If you do hit the limit,
restart the backend — the limiter is in memory.

**Turnstile.** Login refuses a missing `turnstileToken` before it looks at the
password. Locally `TURNSTILE_SECRET_KEY` is Cloudflare's always-passes test
secret, so the helper sends a dummy value. Against an environment with a real
secret these tests cannot log in, by design.

**They write to the database.** The sweep-cron test changes a real setting and
restores it in `afterEach`. Point it at a development database, not production.

**React controlled inputs.** `fill()` sets the value without firing React's
onChange, so the Save button stays disabled and the test times out looking for
an enabled button. Use `pressSequentially()`.

**The notice strip needs something to report.** Its tests assume the seeded
data has sync problems and an ambiguous RM→PL mapping. If the seed changes so
that New joiners has nothing to say, those tests fail with "no notice strip —
has the seed data changed?" rather than passing silently.
