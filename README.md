# TaskForce

The app now uses Supabase by default. See [SUPABASE.md](SUPABASE.md) for local startup, cloud storage and Vercel configuration. The office-PC instructions below apply when explicitly using `TF_BACKEND=sqlite`.

TaskForce is a task and matter tracker for a small conveyancing office. It runs on one office computer, and everyone else opens it in their web browser.

## What it does

- **Board, List and Calendar:** the Board has To do, In progress, Waiting on and Done columns, and you drag a card to change its status.
- **Calendar, laid out like Outlook:** Day, 3 days, Work week, Week and Month (the view menu is top right), with Today and ‹ › buttons.
  - **Left pane:** this month and next as mini calendars (click a date to jump to it), and **My Calendars**, with a tick box for each person, settlement & finance dates, ◆ milestones and call-backs. ‹ hides the pane.
    - **Resizing the month calendars:** drag the handle under them up to make them smaller (all the way up hides them) or down to make them bigger. Double-click the handle to reset. Each PC remembers its own size.
  - **All 24 hours:** the day opens at 8 AM, and you scroll for earlier or later times. ⤢ shows the calendar full screen (Esc to leave).
  - **Drag and drop:** drag a task or call-back to another day or time. Drag it into the "All day" row to remove its time. Drag the bottom edge of a timed task to make it longer or shorter. Dragging a settlement or finance date asks before moving it, because the stage and milestone dates move with it.
  - **Double-click** an empty day or time slot to create a task there. Click an item to select it, and double-click it to open it.
  - **Copy and paste:** click a task and press **Ctrl+C**, then click a day or time and press **Ctrl+V**. Right-click also gives Copy, Paste here, Copy to the next day, and Give to…. Holding **Ctrl while dragging** copies instead of moving. The copy keeps the details and checklist, but not the attachments or notes.
  - **Giving work to someone else:** the **Day – by person** view has a column for each person, and dragging an item to another column hands it to them, at the new time too. In any view, you can also drag a task or call-back onto a name under My Calendars.
- **Matters, set up the way Raikan ran them on monday.com:**
  - **Naming:** each matter is named `BC<number> <type> <client>`, for example "BC1806 P SAMPLE Alex & SAMPLE Jordan".
  - **Types:** P, V, PA, V (PA), LD (land division), Spouse (addition / removal) or Other. The same BC number can have both a P and a V matter.
  - **Settlement date:** leave it blank if it isn't fixed yet. The matter then sits under "Proposed Plan - Not Fixed Date".
  - **Flags:** tick "GST applies" or "SDR (Stamp Duty Relief) claimed" where relevant.
  - **Unconditional contracts:** tick "Unconditional contract – no finance clause" and leave the finance date blank. TaskForce then adds a high-priority task **UNFIN - BC1234** 10 days before settlement (moved back to the previous working day if that's a weekend or public holiday), for the person responsible.
    - It moves when the settlement date moves.
    - It is removed if a finance date is added or the tick is taken off.
  - **Filter by type:** on the Matters tab, tick as many type chips as you like (for example P and V only). "All types" clears the filter.
  - **Grouped by settlement week**, like the Readiness Board, with an "Undated" group. Choose "List" for one plain table.
- **◆ Milestones:** in Admin → Checklist library, click ◆ next to any item to make it a milestone. Each milestone:
  - is a column on the **Readiness Board**, with its own status labels and "counts as done" labels (the old monday.com board columns are set up this way);
  - gets its **due date automatically**, either the stage's due date or a set number of days from opening, finance or settlement;
  - is a bar on the matter's **Gantt chart** tab, with today, finance and settlement marked;
  - can also be switched on or off for one matter with ◆ on its checklist row.
  Because the board reads the checklist, a status is entered once, on the board or the matter, and both update. The board keeps two free note boxes (Text and Text 2). Matters with no settlement date show in an "Undated" group.
- **🔒 Taxation:** a separate **Taxation** tab for tax and bookkeeping jobs (type TAX).
  - **Who sees it:** only admins and staff with **Taxation access**. Turn this on per person in Admin → Staff.
  - **What's hidden from everyone else:** tax jobs, their tasks and call-backs, calendar entries, search results, notifications and the taxation checklists don't appear for them. A tax job also can't be given to someone without access.
  - **Taxation library:** Admin → Checklist library → Taxation checklists. It starts with **DBS - Ashapuri** and **DBS - Nanotech**, copied from the monday.com templates: Document Upload Checks, Do Book Keeping - Invoices, Do Book Keeping - Manual JV, and Do Reconciliations.
  - **Stage due dates:** they count back from the job's due date (period end / lodgement): 5 days, 3 days, 2 days, and on the day. You can change these in the library.
  - **Shared Claude page:** there, taxation is only hidden in the app, because every person who can open the page gets a copy of all its data in their browser. For tax data that must stay private, use the office version, where the server enforces it.
- **Checklist library:** Admin → **Checklist library** holds BC - P, BC - V, LD and Spouse. You can add, rename or delete checklists, stages and items, and choose which checklist each matter type gets by default. LD and Spouse start as copies of BC - P for you to edit.
  - **On a matter:** the New matter form lets you pick the checklist. "+ Add from library" adds another one later (duplicate items are skipped).
- **Stage checklists (BC - P and BC - V):**
  - **Stages:** a new P or V matter gets the full checklist: Contact Details (P only), Stage 1 Greetings, Form1 Review, Stage 2 Formation, Stage 3, Stage 4, Stage 5, Stage 5.1 (P only) and Stage 6. Items and sub-items keep the office's own wording.
  - **What you record:** each item has a Status (using the monday.com labels), Person, Date and Text/amount, plus a notes box.
  - **Due dates:** each stage has one, set from the timeline. Stage 1 is due on instruction, Stage 3 five weeks before settlement, Stage 4 two weeks before, Stage 5 one week before, Stage 5.1 two days before, and Stage 6 on settlement day. Stages that are late show in red.
  - **Handing out work:** ➜ turns any item into a task for someone. When that task is moved to Done, the item is ticked Done too.
- **Readiness Board – next three weeks:**
  - **Layout:** one row per file, grouped by settlement week (Monday to Sunday). It has the same columns and labels as the monday.com board, and V-only and P-only columns show only on the files they apply to.
  - **Ready rule:** a file is ready when every column that applies is in its finished (green) state and the Text note has no PEXA blocker.
  - **PEXA blockers** are spelled out in full. For example, "pot not accepted" shows as "Proprietor on Title hasn't accepted the PEXA invitation".
  - **SDR:** if a purchaser is claiming Stamp Duty Relief, Vendor Data Complete must be "SDR Confirm".
  - **Escalation:** admins get an alert (bell and email) once a day for any file that:
    - isn't ready in its settlement week
    - is Stuck within two weeks of settlement
    - still has a POT/IP blocker in the final week
- **Call-backs:** for missed calls that someone needs to return.
  - **Log a call:** 📞 **Log call** (top bar) records who called, their number, what they want, the matter, who the call was for, who will call back, and when (ASAP, 30 min, 1 hour, this afternoon, tomorrow 9am or a set time). Tick **Urgent** if needed.
  - **Alerts:** the person calling back gets an alert straight away. The **Call-backs** tab shows a red count when calls are due. Overdue call-backs alert both the caller-back and the person the call was for.
  - **Making the call:** clicking the number opens your phone or softphone app.
  - **Logging the result:** choose **Log result** (no answer, voicemail, busy, spoke – resolved, spoke – follow-up needed, wrong number).
    - No answer, voicemail or busy reschedules the call-back.
    - "Spoke" closes it and tells the person the call was for what happened. It can also create a follow-up task.
  - **Repeat callers:** typing the name of someone who called before fills in their number and matter.
  - Each matter has a **Calls** tab.
- **Pop-up alerts:** **My account → Turn on pop-ups** shows a Windows pop-up when a call-back or task is passed to you.
- **Signing in with an emailed code:** in Admin → Email alerts → **Signing in**, choose one of these:
  - password or an emailed 6-digit code (each person's choice);
  - an emailed code only;
  - a password then an emailed code (two-step);
  - a password only.

  Codes need the email server to be set up. Until it is, everyone uses their password. If email ever stops working and nobody can sign in, add `"login_mode": "password"` to `config.json` and restart TaskForce.
- **Phones:** TaskForce works on a phone browser. The menu is under ☰, the board scrolls sideways one column at a time, and the calendar opens in Day view.
- **⏱ Clock in / clock out:** each person clicks **Clock in** in the top bar when they start, and **Clock out** when they finish.
  - **Check-ins:** while someone is clocked in, TaskForce asks them every so often (60 minutes to start with) what they've worked on. It suggests the matters and tasks they touched since the last check-in, so most answers are a click or two. "Remind me in 10 min" puts it off. Clocking out asks for a final note.
  - **Forgot to clock out:** the next time they open TaskForce, it asks what time they actually finished.
  - **Changing the interval:** Admin → **Holidays & time**. Choose "Off" to stop the check-ins.
  - **Time tab:** this shows a weekly timesheet with hours per day and each check-in note.
    - Staff see their own timesheet.
    - Admins can see everyone, correct or add hours, and export a CSV.
- **🌴 Leave:** on the Time tab, or by right-clicking a day in the calendar, staff mark annual leave, sick leave, training, working elsewhere and so on, for whole days or mornings/afternoons.
  - **What the team sees:** the calendar shows the person as away (their column is shaded in Day – by person), and the Board has a "Today" strip of who's away.
  - **Privacy:** only the person and admins see the type of leave and the note. Everyone else just sees "Away".
  - **Admins** get an alert when leave is marked, including how many of that person's open tasks fall due while they're away.
  - **Warnings:** giving someone a task on a day they're away shows a warning.
- **🇦🇺 SA public holidays:** these appear in the calendar (and shade the day) for this year and the next five, under the Public Holidays Act 2023 (SA). That includes the extra Monday or Tuesday when a holiday falls on a weekend, plus the part-day holidays from 7 pm on Christmas Eve and New Year's Eve.
  - **Rolling forward:** a new year is added automatically each January.
  - **Changes:** admins can add one-off holidays or remove one in Admin → Holidays & time.
  - **Due dates:** stage, milestone and UNFIN due dates skip public holidays as well as weekends.
- **Repeating tasks:** set a time and **Repeat** (daily, weekdays, weekly, fortnightly, monthly, quarterly or yearly), optionally with an end date. Ticking one Done creates the next. Upcoming repeats show faintly in the calendar.
- **Tasks:** each task has an assignee, due date, priority, description, checklist, attachments and notes with @mentions. Everything is recorded in an activity log.
- **Attachments:** you can attach any file to a task, including Outlook emails dragged in as `.msg` or `.eml`.
  - **Read:** shows the email and the files attached inside it. Click an attachment to preview it: PDFs, Word (.docx) documents, pictures and text files show right there.
  - **Previewing other attachments:** PDFs, Word documents and pictures attached directly to a task can also be previewed.
  - **New task from an email:** dropping an email into New task fills in the title and the matter.
- **Open in Outlook / Word:** this opens an attached email (or a document) straight in Outlook, Word, Excel or your PDF viewer.
  - It uses a temporary copy, so nothing is saved into your folders.
  - **One-off setup on each PC:** go to My account → **Download the setup for this PC** and double-click the downloaded file. No admin rights are needed.
  - The first time you click Open, the browser asks to allow it. Tick "Always allow" and click Open.
  - If staff later reach TaskForce at a different address (for example through Tailscale from home), run the setup again from that address.
- **Admin:**
  - Manage staff.
  - Edit the checklist library (checklists, stages, items) and the stage due-date timing.
  - Set up email alerts and nightly backups.
  - Set the check-in interval and manage public holidays (Holidays & time).

## First-time setup on the office PC

1. **Install Node.js.** Download the LTS version (22.13 or newer) from https://nodejs.org and install it with the default options.
2. **Copy the TaskForce folder** somewhere permanent, for example `C:\TaskForce`.
3. **Start TaskForce automatically:** right-click `install-autostart.bat` and choose **Run as administrator**. This:
   - starts TaskForce in the background every time you sign in to this PC
   - opens port 3000 in Windows Firewall so other office PCs can connect
   - starts it now and opens it in your browser

   If you only want to try it first, double-click `start.bat` instead and keep that window open.
4. **Create your admin account** in the browser, then go to **Admin → Staff** and add your two staff members with starting passwords.
5. **Tell staff the address.** They open `http://OFFICE-PC-NAME:3000` in Chrome or Edge, replacing OFFICE-PC-NAME with this PC's name. You can find the name in Settings → System → About → Device name.

### Optional settings (Admin menu)

- **Email alerts:** enter your mail server details. For Microsoft 365, use `smtp.office365.com`, port 587. For Gmail or Google Workspace, use `smtp.gmail.com`, port 587 with an app password. Then click **Send me a test email**.
- **Matter task lists:** edit the standard tasks for P, V, PA and Other matters.
- **Backups:** choose the folder (for example `G:\My Drive\TaskForce Backups`), the time, and how many to keep. Click **Back up now** to test it.

## Important

- **The office PC must stay on** for others to use TaskForce. Set Windows sleep to "Never" while plugged in.
- **Working from home:** install Tailscale (free, https://tailscale.com) on the office PC and on each home laptop, signed in to the same account. Staff then use `http://OFFICE-PC-NAME:3000` from anywhere. Don't open port 3000 on your internet router.
- **Dragging from Outlook:**
  - Classic Outlook: drag the email straight into Chrome or Edge and it arrives as a `.msg` file.
  - New Outlook: drag the email to your desktop first, then drag that file in.
  - If a drop does nothing, use the desktop route.
- **Your data** is all in the `data` folder: `taskforce.db` holds the database and `uploads` holds the attached files. Back up that folder, or let the nightly backup do it for you.

## Everyday commands

| File | What it does |
|---|---|
| `start.bat` | Runs TaskForce in a window (closing the window stops it) |
| `install-autostart.bat` | Starts TaskForce at sign-in and opens the firewall (run as administrator) |
| `stop.bat` | Stops the background copy |
| `remove-autostart.bat` | Turns off auto-start and removes the firewall rule (run as administrator) |

## Restoring from a backup

1. Run `stop.bat`.
2. Rename the current `data` folder to `data-old`.
3. Create a new `data` folder and copy `taskforce.db` and the `uploads` folder from the backup into it.
4. Start TaskForce again.

## Updating TaskForce

Run `stop.bat`, then replace every file and folder **except** `data` (and `backups`, if it's there). After that, start TaskForce again.

## Changing the port

If port 3000 is already in use, open `config.json` and change `"port": 3000` to another number, such as 3010. Change `3000` in `install-autostart.bat` to match, run it again, and give staff the new address.
