# GIR Studio Desk

A compact Windows work ledger for GIR. Each worksheet in an imported `.xlsx` workbook becomes a client. Rows become work items; consecutive yellow rows become a deal group. The desktop app keeps a local copy so it opens immediately, then syncs with Supabase when connected.

## Product rules

- **Work:** Pending → Working → Sent → Paid. Starting work again after Sent becomes **Changes**; the number of change rounds stays recorded without cluttering the status label. The assigned person and work state appear live in the sheet and Work Tracker. Working rows are tinted per person; every status cell has its own color.
- **Worksheet:** The worksheet fills the app window with white cells and light gray grid lines. Clients are compact, horizontally scrollable tabs at the bottom. Click a row to select it, Shift-click for a range, double-click a cell to edit, or paste into the selected cell. Blank rows are available below existing work and extend as you scroll. Ctrl + and Ctrl − change grid size.
- **Project groups:** Select rows and choose **Group project** to create a named, collapsible heading. A project group can contain deal groups and its progress also appears in **Groups**. Use its heading to add another work row or rename it.
- **Money:** Estimated incoming is unfinished work at its quoted total. Awaiting payment is sent work or issued invoices. Revenue is money actually recorded as paid.
- **Deals:** A yellow run in the source workbook becomes a group. A group may have a negotiated amount. Its negotiated amount is the financial value for that group; row totals remain visible as reference.
- **Invoices:** Select finished rows, create an invoice, enter seller/client details and optional discount or agreed final amount, then print or save as PDF through Windows. A paid invoice books its final amount once, and the linked rows turn Paid. Its original row totals do not get counted again.
- **Import:** The existing workbook has been imported, so the import control is hidden from the main interface. The migration code remains in the project for future data recovery or a later dedicated import workflow.
- **Legacy advances and discarded work:** Column L is read as the advance taken and shown in the preview and worksheet. A dash (`-`) in the Status column imports as **Discarded** and is excluded from pending work, deadlines, quotes, and income projections. A blank Status imports as **Pending** so ongoing work stays visible.
- **Money view:** A yellow group may show a single agreed amount in column K without a “closed at” label; the preview detects an unambiguous K-column amount and lets you correct it. Advances count as cash received while work remains open, and reduce the remaining estimated or awaiting balance without changing the agreed project amount. The Revenue tab shows monthly received, closed, advance, and discarded figures. Legacy monthly figures use the worksheet date because the source does not record a separate payment date.

## Run

Install the latest `GIR-Studio-Desk-*-Setup.exe` from GitHub Releases. The Supabase project URL and anon key are preconfigured. On first launch, sign in or create an account and confirm the email if prompted. An existing GIR member enters the worksheet automatically. A new teammate enters the code shown in **Settings** on an existing member's PC to join the one GIR workspace and open the migrated clients. Keep both PCs connected for live status updates. Do **not** enter a database password or service-role key in the app.

Local data is stored in `%APPDATA%/gir-studio-desk/ledger.json`. Back up that file before replacing the PC. The app syncs worksheet rows, groups, billing details, and team avatars to Supabase.

## Build

`npm ci` followed by `npm run build:win` produces the Windows installer, its blockmap, and `latest.yml` in `release/`. The installed app checks GitHub Releases when it starts and every six hours. In **Settings**, **Check for updates** finds a release, **Download update** retrieves it, and **Restart to install** applies it. Local worksheet data stays in `%APPDATA%/gir-studio-desk/ledger.json` across app updates.

`build-portable.ps1` still produces the older ZIP-style portable folder for local testing. Portable copies do not self-update; install the release installer to receive in-app updates.
The Desktop folder's `Install GIR Studio Desk.cmd` launches the locally built release installer when one is present.

To publish a future version, bump `package.json`'s version, commit and push, then push a matching tag such as `v0.3.0`. GitHub Actions builds the installer and publishes the installer, blockmap, and `latest.yml` to the release. The update feed is fixed to `getitrendered/gir-studio-desk` in the build configuration. Do not rename or transfer that repository while users have the app installed.

The current installer is not Authenticode signed, so Windows may show an unknown publisher warning. For a signed production release, add a Windows code-signing certificate to the release build and enable update code-signature verification in `package.json`.

## Next setup steps

Invoice seller identity and client billing details are entered in Settings and Client Details; they are not reliably present in the old workbook.
