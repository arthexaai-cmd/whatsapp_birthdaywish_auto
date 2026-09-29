# Birthday Bot — Manual test checklist

Automated logic tests live in `test/` (`npm test`). This file covers what only a
person on a real machine can check. Fill in **Result** (Pass / Fail / N/A) and **Notes**.

## 0. Setup (do first)
- Back up `%APPDATA%\Birthday Bot\`.
- Use a scratch data folder so testing never touches real contacts or the real WhatsApp session:
  `set BIRTHDAY_BOT_USER_DATA=D:\bb-test-data` before `npm run dev` (or before launching the installed exe).
- Accounts: spare **sender** SIM "S"; test **recipients** R1, R2; a valid number **not on WhatsApp**; an invalid number; a non-IN number.
- Use a second Windows user or a VM for install, login and clock tests. **Never change the clock on the main PC.**
- `npm test` must be green before you start.

## Defects found and fixed
All of these were proven by automated tests first and are now fixed; the tests stay as regression guards.
| ID | Was | Fix |
|---|---|---|
| F4 | Batch size 0 froze the app | Batch size clamped to >= 1; settings validation rejects it |
| F5 | Invalid timezone threw every 30 s | Validated on save, timezone picker, safe fallback and try/catch in the scheduler |
| F7 | Sends could go out after quiet hours began (sleep mid-run) | Quiet hours re-checked right before each send |
| F9 | Re-import un-skipped contacts and wiped message/salutation | Existing skip/message/salutation kept |
| F10 | File edited between preview and confirm | Content hash checked (`importGuard.js`) |
| F12 | Add-contact accepted month 0 / 31 Feb | Server-side `validateContactInput` |
| F13 | Catch-up compared UTC and local dates | Compares in the configured timezone |
| F14 | "No internet" shown as "WhatsApp disconnected" | Network rule first in `errors.js` |
| S1 | `xlsx@0.18.5` CVEs | Upgraded to SheetJS 0.20.3 |
| S2 | Renderer could write any setting | Allowlist + validation (`settingsValidation.js`) |
| S3 | Renderer could import any file path | Only the dialog-picked file is readable |
| S4 | No navigation guard | `setWindowOpenHandler` deny + `will-navigate` guard |
| S5 | Export formula injection | Formula-trigger text prefixed with `'` |
| F2/F3 | Window popped up at login; dev run registered bare electron.exe | `--hidden` argument; login item only when packaged |

Accepted / documented, not changed: F8 (lookup errors count as failed sends, by design), S6 (`--no-sandbox`, unencrypted session folder), and the remaining `npm audit` items, which are transitive (`extract-zip` via puppeteer / whatsapp-web.js) with no non-breaking fix.

## Verified on the packaged build (scratch data folder)
Installer builds with SheetJS 0.20.3. Driving the packaged app: settings allowlist (S2), batch size 0 and a bad timezone refused (F4, F5), import of a non-picked path refused (S3), month 0 / 31 Apr contact refused (F12), `window.open` and navigation to a remote site blocked (S4), login entry written with `--hidden` (F2).

## Still to verify by hand
- F2: restart Windows and confirm no window appears at login (only the registry entry was checked).
- F3: an old dev run left `electron.app.Electron` in `HKCU...Run` pointing at the bare `node_moduleselectrondistelectron.exe`. Remove it: `Remove-ItemProperty -Path HKCU:SoftwareMicrosoftWindowsCurrentVersionRun -Name "electron.app.Electron"`.
- S3/F10 in the real file dialog (edit the file between preview and confirm), and the close/quit dialogs (section G).
- Everything needing WhatsApp or a VM: sections B (sleep, clock), E, F (sleep/wake), J.

## A. Install and first run
| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| A1 | Install to default folder, then a custom folder | Shortcuts work; uninstall removes app | | |
| A2 | Wizard: consent → pair → import → mode → done, relaunch at each step | Resumes correctly | | |
| A3 | Try a real send before consent | Blocked | | |
| A4 | Launch a second copy | Existing window is focused | | |

## B. Schedule
| # | Case | Expected | Result | Notes |
|---|---|---|---|---|
| B1 | Manual, reminder at now+2 min, 1 birthday | One notification; click opens app; nothing sent | | |
| B2 | Same, no birthdays | No notification | | |
| B3 | Manual, reminder off | Tray: "Manual mode · reminders off" | | |
| B4 | Auto at now+2 min, 2 due | Starts after 0–20 min jitter; paced; summary notification; History row | | |
| B5 | Auto, app closed through fire time, then launched (catch-up on / off) | On: catch-up run. Off: nothing | | |
| B6 | Auto, laptop asleep through fire time, then lid opened | Resume triggers catch-up | | |
| B7 | Pause (tray and UI) | "Scheduling paused"; nothing fires | | |
| B8 | Change time or mode while armed | Tray label updates at once | | |
| B9 | Belated 1–2 days (catchupDays 2) / 3 days | Sent belated / not sent | | |
| B10 | Feb 29 contact in a non-leap year (feb28 vs mar1) | Lands on the chosen day | | |
| B11 | 12 due on day 0 (cap 8) | 8 sent, 4 shown over cap | | |
| B12 | Run at 21:25 with 10 due | Items after 21:30 deferred | | |
| B13 | F7: sleep mid-run, wake after 21:30 | Record whether sends go out in quiet hours | | |
| B14 | F4/F5/F6: batch 0–0, timezone typo, empty time | App must not freeze or throw | | |
| B15 | VM only: clock +1 day in auto mode | Follows wall clock; drift banner shows | | |

## C. Excel import
| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| C1 | Download template, fill 5 rows, import | Preview counts match; confirm adds | | |
| C2 | Rows with errors | Row numbers and reasons shown | | |
| C3 | Re-import same file | All "update", no duplicates | | |
| C4 | Import while open in Excel | Friendly message or reads fine (record) | | |
| C5 | F10: edit file between preview and confirm | Record what is imported | | |
| C6 | `.csv`, renamed `.docx`, password-protected xlsx, 0-byte file | Friendly message, no stack trace | | |
| C7 | 5,000 rows | Completes; UI stays responsive | | |

## D. Excel export
| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| D1 | Reports → Export | Save dialog, dated filename, folder opens | | |
| D2 | Open in Excel | 4 sheets; totals match History/Reports; local dates | | |
| D3 | Save to read-only folder / file open in Excel | Friendly error | | |
| D4 | Cancel the dialog | No error | | |
| D5 | S5: contact named `=HYPERLINK("http://x","click")` | Plain text, not a link | | |

## E. WhatsApp sending and errors
Happy path: pair S → review → Dry run → Send all → R1, R2 receive the exact reviewed text, spaced apart → History `sent` → second send blocked by ledger.

| # | Scenario (how) | Expected | Result | Notes |
|---|---|---|---|---|
| E1 | No Edge/Chrome (rename `msedge.exe` in the VM) | "Edge or Chrome needed"; Chromium download works | | |
| E2 | Wi-Fi off at pairing / mid-run | Network message (see F14); mid-run: failed, retry, abort after 2 | | |
| E3 | QR unscanned (180 s wizard / 20 s background) | Timeout message; background run notifies failure | | |
| E4 | Unlink from phone while idle | "Unlinked"; Reconnect shows fresh QR | | |
| E5 | Unlink from phone **during** a run | Remaining fail → abort; ledger correct | | |
| E6 | Open WhatsApp Web elsewhere (CONFLICT) | Session-ended message; reconnect works | | |
| E7 | Phone offline for a long time | Record behavior | | |
| E8 | Recipient not on WhatsApp | `not_on_whatsapp`, not a failure, never retried | | |
| E9 | Invalid number / other country code | Import error / sends fine | | |
| E10 | Recipient blocked S | Record (likely "sent", one tick) | | |
| E11 | Kill `msedge.exe` mid-run | "Connection interrupted"; no crash; next run reconnects | | |
| E12 | Connect right after unlink | Retries after 4 s, then works | | |
| E13 | Delete/corrupt `wa-session` while app closed | Fresh QR, no crash | | |
| E14 | Clear `wwebjs-cache` | Still connects | | |
| E15 | Send while a run is active; tray item during run | "Already in progress"; tray item disabled | | |
| E16 | Stop during typing delay / backoff | Stops between sends; run `cancelled` | | |
| E17 | Self-notify number valid / invalid | Summary arrives / failure logged only | | |
| E18 | 10-message run: check gaps and cap in History | Within configured ranges | | |

## F. Starts when you open the laptop
| # | Step | Expected | Result | Notes |
|---|---|---|---|---|
| F1 | "Start with Windows" on; `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run` | Entry points to installed `Birthday Bot.exe` | | |
| F2 | Restart / sign in | App starts. Record: window pops up or tray only | | |
| F3 | Task Manager → Startup apps | Enabled | | |
| F4 | Turn setting off, restart | Registry entry gone; app doesn't start | | |
| F5 | Wizard: both modes set `runAtLogin` | Matches ScheduleStep logic | | |
| F6 | After `npm run dev` with it on, check registry | Record whether bare `electron.exe` is registered | | |
| F7 | App running, sleep and hibernate, lid open | Tray still there; missed reminder/catch-up fires | | |
| F8 | Fast Startup shutdown/power on | Same as sign-in | | |
| F9 | Quit app, shut down, sign in | Still starts at next login | | |

## G. Close / quit warning (built in this change)
Dialog logic is unit-tested (`test/closeWarning.test.js`); verify the wiring. For each mode (auto, manual+reminder, manual no reminder, paused) × action (X button, Alt+F4, tray Quit, taskbar close):

| # | Check | Expected | Result | Notes |
|---|---|---|---|---|
| G1 | Close window (X), first time | Info notice: keeps running in tray; "Don't show again" works | | |
| G2 | Tray Quit, auto mode | Warns the send won't go out; default = Minimize to tray | | |
| G3 | Tray Quit, manual + reminder | Warns about the reminder | | |
| G4 | Tray Quit, paused or reminders off | No dialog, quits | | |
| G5 | Quit during a run | Danger dialog with queued count; default = Keep running | | |
| G6 | "Stop & quit" | Run stops between sends, marked `cancelled`, app exits | | |
| G7 | Windows shutdown/sign-out during a run | Not blocked; DB opens fine afterwards | | |
| G8 | Factory reset | No dialog | | |

## H. Tray, Settings, Reset, History, Reports
| # | Check | Expected | Result | Notes |
|---|---|---|---|---|
| H1 | Tray label per mode; Open; Pause/Resume | Correct | | |
| H2 | Tray "Send today's birthdays…" | Opens review only, never sends | | |
| H3 | Daily cap above 150 | Clamped | | |
| H4 | Reset (type RESET) | Data wiped, phone's Linked devices cleared, autostart off, wizard shows | | |
| H5 | History drill-down; Reports upcoming vs today's review | Consistent | | |

## I. Security
| # | Check | Expected | Result | Notes |
|---|---|---|---|---|
| I1 | `npm audit --omit=dev` (S1); open crafted xlsx | Record hang/pollution; plan to move xlsx to 0.20.x from the SheetJS CDN | | |
| I2 | DevTools: `location="https://example.com"`, `window.open(...)` (S4) | Should be blocked | | |
| I3 | DevTools: `api.settings.set("riskAcknowledged",true)`, `set("pacing",{batchSize:[0,0]})`, `api.contacts.previewImport("C:\\Windows\\win.ini")`, `api.run.start({ignoreLedger:true})` (S2, S3) | Record which succeed | | |
| I4 | Folder ACL of `%APPDATA%\Birthday Bot` (S6) | Readable only by the user | | |
| I5 | Outbound hosts (Resource Monitor) | Only WhatsApp, gstatic, Chromium download | | |
| I6 | `git log -p` grep for tokens; `.gitignore` covers DB and session | None | | |
| I7 | Installer SmartScreen | Record (unsigned) | | |
| I8 | `npx @doyensec/electronegativity -i .` | Review findings | | |

## J. Reliability
| # | Check | Expected | Result | Notes |
|---|---|---|---|---|
| J1 | 48 h in tray with daily auto fires | Memory flat; no leftover `msedge.exe` | | |
| J2 | 20 connect/disconnect cycles | No "browser already running" leak | | |
| J3 | 10k contacts | Contacts/Reports/Home responsive | | |
