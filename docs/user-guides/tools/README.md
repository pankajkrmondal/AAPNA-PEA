# Exporting the guides to Word and PDF

The `.md` files in `docs/user-guides/` are the source. The Word and PDF copies in `exports/` are made from them, for sharing with the HR team. Never edit the exports by hand: change the `.md` file and export again.

## How
From the `PEA-Local` folder, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "docs\user-guides\tools\export-guides.ps1"
```

One guide only:

```powershell
powershell -ExecutionPolicy Bypass -File "docs\user-guides\tools\export-guides.ps1" -Only 01-HR-GUIDE.md
```

It needs **pandoc** on the PATH (Anaconda includes it) and **Microsoft Edge**. Word is not needed. Close any export that is open in Word or a PDF reader first, or it cannot be overwritten. The whole run takes about 15 seconds.

## What it does
1. **pandoc** turns each `.md` into a `.docx`, using a Word template whose tables have borders and a shaded header row (made fresh from pandoc's own template on each run).
2. **pandoc** also turns each `.md` into one self-contained web page (pictures and `guide-print.css` included), and **Edge**, running hidden, prints it to `.pdf` on A4.
3. The `strip-md-links.lua` filter keeps the text of links to other guides but removes the link, since it would not work in a standalone file. Links within a guide (the Contents) keep working.

| Source | Exported as |
|---|---|
| `README.md` | `00-PEA-OVERVIEW` |
| `01-HR-GUIDE.md` | `01-HR-GUIDE` |
| `02-ADMIN-GUIDE.md` | `02-ADMIN-GUIDE` |
| `03-SUPERADMIN-GUIDE.md` | `03-SUPERADMIN-GUIDE` |
| `04-MANAGERS-AND-COMMANDOS.md` | `04-MANAGERS-AND-COMMANDOS` |

**Why Edge and not Word for the PDF:** the ATS guides' PDFs were saved from Word. Driven from a script, Word kept stopping on a prompt it never showed, and the export hung. Edge has no prompts to wait on. The look of the PDF is set in `guide-print.css`.

## Screenshots
Pictures live in `images/` and are referenced from the guides as `images/<name>.jpg`. Every picture named in a guide must exist, or the PDF step stops with "not found in resource path".

They were taken on staging on 28-10-2026 with **sample names**. A script in the browser replaced every real name and email on the page before each picture, so the guides can be shared without showing anyone's evaluations. The "No email is being sent" badge, which staging always shows, was hidden. The manager's evaluation form (`manager-01-evaluation-form.jpg`) was rendered from PEA's own form page with sample data, because opening a real manager's link marks it as opened.

To retake one, use the same screen on staging, replace any real names first, and keep the file name.
