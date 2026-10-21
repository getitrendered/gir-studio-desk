# GIR Studio Desk

A compact Windows work ledger for GIR. Each worksheet in an imported `.xlsx` workbook becomes a client. Rows become work items; consecutive yellow rows become a deal group. The desktop app keeps a local copy so it opens immediately, then syncs with Supabase when connected.

## Product rules

- **Work:** Pending → Working → Sent → Paid. Starting work again after Sent becomes **Changes 1**, then **Changes 2**, and so on. The assigned person and work state appear live in the sheet and the team rail.
- **Deadlines:** Each row can have a due date. Dashboard and Deadlines show overdue and upcoming work.
- **Money:** Estimated incoming is unfinished work at its quoted total. Awaiting payment is sent work or issued invoices. Revenue is money actually recorded as paid.
- **Deals:** A yellow run in the source workbook becomes a group. A group may have a negotiated amount. Its negotiated amount is the financial value for that group; row totals remain visible as reference.
- **Invoices:** Select finished rows, create an invoice, enter seller/client details and optional discount or agreed final amount, then print or save as PDF through Windows. A paid invoice books its final amount once, and the linked rows turn Paid. Its original row totals do not get counted again.
- **Import:** Choose a workbook, inspect every client and row in the in-app preview, check each yellow group's detected **closed at** amount, and click **Migrate to Supabase**. Uploading alone writes nothing to the ledger or database. Headers are found by text, so blank spacer columns and top branding rows are allowed. The migration inserts clients, groups, and rows in one database transaction. Retrying the exact same workbook is idempotent; a modified workbook is treated as a new import and duplicate client names are flagged in the preview.

## Run

Install the latest `GIR-Studio-Desk-*-Setup.exe` from GitHub Releases. The Supabase project URL and anon key are preconfigured, and the database schema and import migration have been installed. In **Settings**, each person selects **Create account**, confirms their email if prompted, and signs in. The first signed-in user creates a workspace; the second signs in and joins using the workspace code shown in Settings. Keep both PCs connected for live status updates. Do **not** enter a database password or service-role key in the app.

Local data is stored in `%APPDATA%/gir-studio-desk/ledger.json`. Back up that file before replacing the PC. The app never uploads the workbook file itself; only the mapped client, group, and row data is sent when you click **Migrate to Supabase**.

## Build

`npm ci` followed by `npm run build:win` produces the Windows installer, its blockmap, and `latest.yml` in `release/`. The installed app checks GitHub Releases when it starts and every six hours. In the right sidebar, **Check for updates** finds a release, **Download update** retrieves it, and **Restart to install** applies it. Local worksheet data stays in `%APPDATA%/gir-studio-desk/ledger.json` across app updates.

`build-portable.ps1` still produces the older ZIP-style portable folder for local testing. Portable copies do not self-update; install the release installer to receive in-app updates.

To publish a future version, bump `package.json`'s version, commit and push, then push a matching tag such as `v0.3.0`. GitHub Actions builds the installer and publishes the installer, blockmap, and `latest.yml` to the release. The update feed is fixed to `getitrendered/gir-studio-desk` in the build configuration. Do not rename or transfer that repository while users have the app installed.

## Next setup steps

Two team accounts and a workspace still need to be created in the app. Invoice seller identity and client billing details are entered in Settings/client details; they are not reliably present in the old workbook. The screenshot shows the **closed at** pattern, but an actual `.xlsx` file is needed to verify its exact colors, merged-cell patterns, and formulas.
