# Birthday Bot

A standalone desktop app: import a contact list, connect WhatsApp, and each
day review today's birthday wishes and send them with one click — or switch
it to send automatically at a set time. Either way, pacing is designed to
look human rather than machine-scripted.

No terminal, no cloud account, no Google. Everything (contacts, message
templates, schedule, send history) lives in a local database on your own
computer.

## How it works

- **Contacts**: import once from an Excel file (`name`, `phone`,
  `birthdate`, plus optional `custom_message`, `salutation`, `skip`
  columns), then add/edit/delete people directly in the app afterwards.
  Deleting someone keeps their past sends in History and Reports.
- **WhatsApp**: pairs like WhatsApp Web normally does — scan a QR code once,
  the session persists. Runs through your existing installed browser (Edge
  or Chrome), not a bundled one, to keep the installer small.
- **Sending (manual by default)**: open the app and the Dashboard lists
  today's birthdays (plus belated catch-ups) with the exact message each
  person will get; press **Send all**. Nothing is sent unless you press it.
  Optionally, the app waits in the system tray and shows a reminder
  notification at a daily time when there are birthdays to send.
- **Automatic mode (opt-in, Schedule tab)**: the app sends by itself at the
  daily time, even with the window closed (it runs in the tray — keep the
  computer on and connected). If the computer was off or asleep at that
  time, it catches up the next time it's opened. It acts on whatever date
  the computer's clock shows, so a wrong or manually-changed clock sends
  real wishes on the wrong day.
- **Reports**: everything sent so far and the upcoming per-day schedule,
  exportable to Excel.
- **Reset everything (Settings)**: deletes all contacts, messages, settings
  and send history, logs WhatsApp out, and restarts the app at the setup
  wizard — like a fresh install. You type `RESET` to confirm, and can export
  a report first. It can't be undone.

## Testing safely

The app always acts on today's date *as the computer's clock shows it*, and
a Send is real. So:

- Use **Dry run** on the Dashboard to see exactly who would get what, and
  when, without sending anything.
- **Don't change the computer's clock to "test a birthday".** The app can't
  tell a test date from a real one — it will send real wishes for that date.
- `npm run dev` uses the same data folder as the installed app (see
  [Database](#database)), so development runs against your real contacts
  and WhatsApp session.
- **Pacing**: messages go out in randomized batches with jittered delays, a
  simulated typing pause, quiet hours, a daily cap, and a warm-up ramp for a
  freshly-paired number — see [Risk notes](#risk-notes).

## Development

```bash
npm install
npm test        # 332 tests over the pure selection/pacing/DB/schedule logic
npm run dev      # Vite dev server + Electron, with hot reload
```

### Updates and releases
The installed app checks GitHub Releases for a newer version and offers it
(Settings → Updates, plus a banner on the Dashboard); nothing installs without
a click, and never while messages are being sent. Releases are built by GitHub
Actions when you push a version tag (`npm version minor && git push
--follow-tags`). See [docs/RELEASING.md](docs/RELEASING.md).

`npm run dev` starts the React UI on `localhost:5173` and launches Electron
pointed at it. Edit anything under `src/ui/` and it hot-reloads; edit
anything under `electron/` or `src/core/` and restart `npm run dev`.

### Project layout

```
electron/         Main-process code: window, tray, scheduler, IPC, DB wiring
src/core/          Pure, unit-tested engine: selection, pacing, messages, DB
                    schema/queries, WhatsApp client lifecycle. No Electron
                    dependency -- testable in plain Node/Vitest.
src/ui/            React renderer (Vite): the wizard + dashboard screens
test/              332 Vitest tests covering src/core/
config/            messages.yaml: default message templates, seeded into the
                    DB on first run only (never overwrites user edits)
build/             Installer icon + tray icon (placeholders -- see below)
```

The split matters: `src/core/` has zero Electron imports, so the actual
logic — birthday matching, Feb 29 handling, pacing math, DST-correct
scheduling, message rendering, the SQLite ledger's idempotency — is tested
directly with Vitest, no Electron process needed. `electron/` is thin glue:
window lifecycle, IPC plumbing, and wiring real paths/timers to that logic.

### Database

SQLite via Node's built-in `node:sqlite` (no native module compilation, no
`electron-rebuild`, no prebuild-binary matching against whatever Electron
ships — important for a distributable app where end users never run a build
step). Lives in Electron's `userData` folder, `%APPDATA%\Birthday Bot\` on
Windows, alongside the rest of the app's data:

```
birthday-bot.sqlite (+ -wal, -shm)   contacts, templates, settings, send history
wa-session/                          the linked WhatsApp session
wwebjs-cache/                        cached WhatsApp Web version
chromium/                            fallback browser (only if one was downloaded)
```

**Reset everything** deletes all of these except `chromium/` (a large
download with no personal data).

The `sends` table's `ledger_key` column is `UNIQUE`, keyed on
`phone:birthday-occurrence`. That's the actual idempotency guarantee: even
if the app crashes mid-run and a scheduled/catch-up run retries, the same
person can never be sent to twice for the same birthday. A `failed` entry
stays retryable and is overwritten by the retry's result; `sent` and
`not_on_whatsapp` entries are final. The ledger is keyed on the phone
number, not the contact, so deleting and re-adding a contact doesn't make
an already-sent birthday sendable again (a factory reset does clear it).

## Building an installer

```bash
npm run build
```

Produces a Windows installer under `dist-installer/` via `electron-builder`
(NSIS). Before a real release:

- **Replace the placeholder icons.** `build/icon.ico` and
  `build/tray-icon.png` are generated by `scripts/gen-icons.mjs` as a solid
  color placeholder so the app runs and packages without needing design
  tools first — swap them for real branding.
- **Code signing.** An unsigned installer triggers a Windows SmartScreen
  warning ("Windows protected your PC" → More info → Run anyway). Getting
  past that cleanly needs a paid code-signing certificate (~$200–400/yr).

## Risk notes

This automates WhatsApp Web in a way its Terms of Service prohibit, and
WhatsApp can restrict or ban a number that does this — the app can reduce
that risk but never remove it. The first-run wizard requires explicit
acknowledgment of this before any real (non-dry-run) send. Concretely, the
app:

- Validates every number is actually registered on WhatsApp before sending,
  and never retries one that isn't (the single strongest ban signal is
  sending to numbers that don't exist on WhatsApp).
- Varies message text via a template pool + variable substitution, so a
  day's sends aren't byte-identical.
- Sends in randomized batches with jittered delays and a simulated typing
  pause, never inside a configurable quiet-hours window.
- Enforces a daily cap (default 100, with a hard UI ceiling of 150), spread
  over most of the day. An optional warm-up (Schedule tab) can ramp a
  freshly-paired number up gradually; it is off by default.
- Aborts the whole run after a couple of consecutive send failures, rather
  than hammering a degraded session.

Use a number you can afford to lose, and always try a **Dry Run** (visible
on the dashboard) before a real send — it shows exactly who would receive
what, and when, without sending anything. Manual sends (Send all) use the
same pacing as automatic ones, so a day's messages go out spread over some
minutes — keep the app open until the run finishes.
