# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

**Birthday Bot** (v2.0.0) — a standalone Windows Electron desktop app that
sends birthday wishes over WhatsApp Web, with human-like pacing to reduce
ban risk. **Sending is manual by default**: the user opens the app, reviews
today's birthdays and the exact messages, and presses Send all. Automatic
daily sending is an opt-in mode. Contacts, templates, settings, and send
history live in a local SQLite DB. Started as a CLI bot; converted to
Electron in commit `9eabcc3`. See [README.md](README.md) for user-facing docs.

## Commands

```bash
npm install
npm test          # vitest run -- 449 tests over src/core/ and src/ui/errors.js (plain Node, no Electron)
npm run dev       # Vite (localhost:5190, strictPort) + Electron with ELECTRON_DEV=true
npm run build     # vite build -> dist-ui/, then electron-builder NSIS -> dist-installer/
```

UI changes under `src/ui/` hot-reload; changes under `electron/` or
`src/core/` need the app restarted. Requires Node >= 20 (uses the built-in
`node:sqlite`). Keep the test count here and in README in sync.

## Architecture

The key rule: **`src/core/` has zero Electron imports.** All domain logic is
pure and unit-tested there; `electron/` is thin glue that wires real paths,
timers, and IPC to it. Keep it that way — new logic goes in `src/core/` with
a test, not in `electron/`.

- `src/core/` — pure engine
  - `engine.js` — orchestrator: load contacts → match birthdays → dedupe vs
    ledger → paced schedule → send/dry-run → record. Takes injected `db` and
    `waClient` (null for dry run) and an `AbortSignal`.
    - `findDueMatches()` is the single "who is due now" rule, shared by
      `runEngine`, `hasPendingMatches()` (lets a run skip launching the
      browser when there's nothing to send) and `previewToday()`.
    - `previewToday()` builds the Dashboard review list: due people and the
      exact rendered text, `overCap`, and `alreadySentToday`.
    - `approved` (object of ledgerKey → text) narrows a run to exactly the
      reviewed people and sends exactly the reviewed text. Templates are
      randomized per render, so never re-render reviewed messages.
    - `dateOverride` / `ignoreLedger` are testing aids.
  - `birthdays.js` — matching, Feb 29 via `leapDayFallback`, catch-up days,
    `todayInTz()` (shared "today in the configured timezone").
  - `schedule.js` — DST-correct fire-time math, plus:
    - `scheduledAction(settings)` → `"send" | "remind" | "none"`: what the
      daily trigger does.
    - `evaluateSchedulerTick()`: the wall-clock polling decision (see gotchas).
    - `hasRunToday()`: gates the automatic-mode launch catch-up.
  - `progress.js` — Reports tab + Excel export: ledger totals, and the
    upcoming per-day schedule predicted with the engine's own matching rules
    (`buildUpcomingSchedule`). Also `buildReportWorkbook` (4 sheets). Stress
    tested at 10k rows.
  - `closeWarning.js` — `closeDecision()`: what the close/quit dialog says (none/info/warn/danger). `main.js` (`requestQuit`, window `close`, `before-quit`) shows it; tray Quit goes through `requestQuit`. OS shutdown (`session-end`) is never blocked.
  - `settingsValidation.js` — `validateSetting(key, value)`: allowlist + range checks for everything the renderer writes via `settings:set` (bad batch size / timezone / times rejected; main-only keys like `lastReminderDate`, `dailyCapMax`, `hasEverPaired` blocked). New renderer-writable settings must be added here.
  - `importGuard.js` — Excel import IPC guard: only the dialog-picked path may be read, and confirm refuses if the file changed since the preview.
  - `updatePolicy.js` — `canInstallNow()` (refuses an update install during a run, or within 30 min of an Automatic-mode send), `reduceUpdateState()` (the update state machine the UI renders), `shouldCheckNow()`. `electron/updater.js` wraps `electron-updater` (packaged app only; `autoDownload`/`autoInstallOnAppQuit` off; nothing installs without a click); `electron/ipc/updates.js` + `window.api.updates`; UI in `UpdateBanner.jsx` / `UpdatesCard.jsx`. Releases are built by `.github/workflows/release.yml` on a `v*.*.*` tag (see `docs/RELEASING.md`). The feed override `BIRTHDAY_BOT_UPDATE_URL` only works together with `BIRTHDAY_BOT_USER_DATA` (test mode).
  - `reset.js` — `wipeAppData(userDataPath)` for factory reset. Deletes the
    DB (+ WAL/SHM), `wa-session/`, `wwebjs-cache/` and `main.log`; keeps the
    `chromium/` download cache.
  - `browserLock.js` — `clearStaleBrowserLock()`: removes the WhatsApp browser
    profile's leftover `lockfile`. On Windows Puppeteer reports *any* launch
    failure (even a timeout) as "browser is already running" while that file
    exists; deleting it only succeeds when no live browser holds it. The
    root cause seen in the field was Edge relaunching itself (exit code 0,
    orphaned browser); `whatsapp.js` passes `--edge-skip-compat-layer-relaunch`
    to prevent it -- don't remove that switch.
  - `pacing.js` (batches, jitter, quiet hours, daily cap, warm-up ramp),
    `messages.js` (template rendering, random emoji), `roster.js` + `xlsx.js`
    (Excel import/validation, downloadable blank template), `clock.js` (clock
    drift classification), `report.js` (per-run summary text).
  - `db.js` — schema/migrations + all queries. Tables: `schema_meta`,
    `contacts`, `templates`, `template_vars`, `settings`, `runs`, `sends`.
    - `sends.ledger_key` is `UNIQUE` on `phone:birthday-occurrence`. That is
      the idempotency guarantee against double-sends; don't weaken it.
    - `recordSend` overwrites a row only while it is `failed`, so a retry's
      outcome replaces the failure. Terminal rows (`sent`, `not_on_whatsapp`)
      are never overwritten.
    - `deleteContact` sets `sends.contact_id` to NULL before deleting (it's a
      foreign key). History keeps its own name/phone copy, and the
      phone-based ledger survives, so a re-added person isn't double-sent.
  - `defaults.js` — `DEFAULT_SETTINGS` seeded once; `migratePacingToCurrentDefaults` (run once from `electron/db.js`, gated by `pacingDefaultsVersion`) moves installs still on the old pacing defaults to the new ones, field by field, leaving user-edited fields alone. Bump `PACING_DEFAULTS_VERSION` and extend it if pacing defaults change again. `fillMissingDefaults`
    only adds missing keys, never overwrites user edits. Includes `sendMode`
    (`"manual"` default | `"auto"`) and `reminderEnabled`.
  - Birthday cards (setting `messageFormat`: `"text"` default | `"image"` | `"both"`; `"both"` = card with the wish as caption). `cardLayout.js` (pure: `CARD_FONTS` -- 20 fonts grouped by `category` -- `clampBox`, `fitText`, `validateCardConfig`, `isValidHexColor`/`contrastStrokeColor` (the colour is a free-form hex string, not a fixed palette id), `normalizeRotationDeg`/`unrotateDelta` (box rotation); also imported by the UI), `cardRender.js` (`renderCard`, `makeCardRenderer`, via `@napi-rs/canvas`; rotates the canvas around the box centre for a tilted name box; the same renderer draws the editor preview, the review thumbnails and the sent image), `cardImage.js` (`importBackground`: validates/shrinks the picked picture into `<userData>/cards/background.jpg`), `messages.js` `cardName` (salutation + name + postfix, exactly as stored). `cardConfig` is a main-process-only setting written by `electron/ipc/cards.js`, never by `settings:set`. `runEngine` takes an injected `renderCard(person)`; if it is missing or throws, that person gets the text wish (`card_fallback` event). Fonts and the starter picture live in `assets/` (shipped via `extraResources`; regenerate the starter with `scripts/gen-starter-card.mjs`). UI: `Cards.jsx` tab, plus `CardThumb` in `Home.jsx`.
  - Birthday emails (separate channel, own **Email** tab and "Send emails" button; never sent automatically). `emailEngine.js` (`previewEmailsToday`, `runEmailEngine`, `classifyMailError`, `friendlyMailError`; mail transport injected, so tests use a fake), `emailBody.js` (subject + HTML with the card inline via `cid:`), `emailAccounts.js` (sender-account validation, presets, daily-cap maths), `emailAddress.js` (`isValidEmail`, UI-safe). **Every selected sender account emails every due person** (one email per person per account; not load sharing). Own ledger table `email_sends` (key `<senderId>:<email>:<date>`), schema v2 (`contacts.email`; the first ALTER migration in `migrate()`). An auth/quota reply stops only that account for the run. Account details (no passwords) are the main-only setting `emailAccounts`; passwords are encrypted with Electron `safeStorage` in `<userData>/email-secrets.bin` (`electron/emailSecret.js`) and never sent to the renderer; both are removed by factory reset. Glue: `electron/emailManager.js`, `electron/ipc/email.js`, `window.api.email`. Excel import has an optional `email` column. On Windows, `main.js` injects the OS certificate store into Node's trust store at startup via `win-ca` (`"+"` mode, best-effort try/catch) — some antivirus/corporate-proxy setups do TLS interception with a CA Windows trusts but Node doesn't, which otherwise fails every email send with "self signed certificate in certificate chain".
  - `whatsapp.js` — whatsapp-web.js `Client` lifecycle (LocalAuth session,
    web-version cache), number validation, `sendWithTyping`.
- `electron/` — main process glue
  - `main.js` — window, single-instance lock, wiring, and:
    - `onFire`: branches on `scheduledAction()`. "send" starts a run.
      "remind" calls `remindIfDue` (a notification at most once per day,
      tracked in the `lastReminderDate` setting; never sends).
    - `factoryReset()`: cancel the run, stop the scheduler, log out of
      WhatsApp, turn off start-with-Windows, `closeDb`, `wipeAppData`, then
      `app.relaunch()` + `app.exit(0)`.
  - `scheduler.js` — 30 s wall-clock poll plus `powerMonitor` resume and
    launch catch-up. In manual mode the catch-up becomes a reminder.
  - `runManager.js` — one run at a time; passes `approved` through.
  - `whatsappManager.js` — single client, QR → data URL. `unlink()` wipes the
    local session. `logOutAndUnlink()` first tries a real logout, capped at
    10 s, so the phone's Linked devices list is cleaned up too.
  - `browser.js` (finds system Edge/Chrome/Chromium; one-time Chromium
    download fallback), `logFile.js` (mirrors stdout/stderr into
    `<userData>/main.log`;
    the first place to look when connecting fails on someone else's PC),
    `clockCheck.js` (drift via HTTPS `Date` header),
    `tray.js` (mode-aware "Next reminder"/"Next send" label; its "Send
    today's birthdays…" item only opens the review screen).
  - `ipc/*.js` — one file per channel group, registered in `ipc/index.js`
    (contacts, messages, settings incl. `settings:factoryReset` + history,
    whatsapp, run incl. `run:previewToday`, clock, reports).
  - `preload.cjs` — the only renderer bridge (`window.api`), CommonJS on
    purpose. Adding an IPC channel means updating both `ipc/*.js` and
    `preload.cjs`. `contextIsolation` on, `nodeIntegration` off.
- `src/ui/` — React 19 renderer (Vite root).
  - First run: no wizard and no gate. The app opens on the Dashboard, which
    shows a dismissible **Get started** checklist (`GetStarted.jsx`: add
    contacts, set up WhatsApp, set up Email -- all optional, any order).
    WhatsApp is set up on demand in `WhatsAppSetup.jsx` (a dialog: the
    ban-risk notice, then `PairStep` with the browser check/Chromium download
    and QR), opened from the checklist, Home or Settings. Rules live in
    `src/core/onboarding.js`: `canSendWhatsapp` (notice accepted AND paired
    once) is enforced by `assertCanSendWhatsapp` in `runManager.start` for every
    real WhatsApp run, and `scheduledAction` only returns `"send"` in auto mode
    when it holds (otherwise it reminds). `onboardingDismissed` hides the
    checklist; `electron/db.js` sets it once for installs that were already
    set up.
  - `Dashboard` tabs: home, contacts, messages, cards, email, schedule, history,
    reports, settings.
    - Home: the "Today's birthdays" review list with Send all / Send now,
      which confirms first and sends `approved`.
    - Schedule: sending mode, reminder, pause, pacing.
    - Reports: progress + upcoming + Export to Excel.
    - Settings: ends with `ResetCard` (type `RESET` to confirm).
  - Shared components: `SendModeFields` (used by the Schedule
    tab), `ResetCard`, `ClockCard`, `ImportErrors`.
  - The CSP in `src/ui/index.html` has no external `connect-src`; network
    calls belong in the main process. The renderer may import pure
    `src/core` modules (e.g. `clock.js`), but not ones that pull in `xlsx`
    or `node:*`.
- `config/messages.yaml` — default templates, shipped via `extraResources`.
- `build/` — placeholder icons generated by `scripts/gen-icons.mjs`.

## Conventions and gotchas

- ESM everywhere (`"type": "module"`) except `preload.cjs`.
- Comments explain *why* at length (see file headers); match that style.
- **Manual by default is deliberate.** An unattended sender acts on whatever
  date the PC clock shows. In testing, a manually changed clock sent real
  wishes days early. Don't make anything send without an explicit user
  action unless `sendMode === "auto"`.
- **The scheduler polls the wall clock** (`evaluateSchedulerTick`, every
  30 s) instead of one long `setTimeout`. Node timers count elapsed time and
  ignore OS clock changes, so a 24 h timeout never followed clock
  corrections.
- Set `BIRTHDAY_BOT_USER_DATA=<dir>` to run against a scratch data folder instead of the real one (used for testing; see docs/TEST_PLAN.md).
- **Dev and the installed app share one data folder**:
  `%APPDATA%\Birthday Bot\` (DB, `wa-session/`, `wwebjs-cache/`,
  `chromium/`). Running `npm run dev` uses the user's real contacts and
  WhatsApp session, and a real Send really sends. Test with Dry run. Never
  test by changing the system clock, never click Send or Reset in the
  user's app on your own, and prefer read-only inspection of the DB.
- Driving the dev app: launch Electron with `--remote-debugging-port=9222`
  and connect with the project's own `puppeteer-core`
  (`puppeteer.connect({ browserURL: "http://127.0.0.1:9222" })`); nav items
  are `.nav-item`. To restart, kill `electron.exe` and the Vite process on
  :5190. Stopping the `npx` wrapper leaves the children running, and the
  single-instance lock then makes a new launch quit immediately.
- whatsapp-web.js calls into WhatsApp's internal Store break often. Treat
  cosmetic calls (e.g. typing presence via `getChatById`/`sendStateTyping`)
  as best-effort in try/catch — a failure there must never block
  `sendMessage()` (fixed in `c489185`). Log full errors with stack on send
  failures.
- **whatsapp-web.js is patched** (`patches/whatsapp-web.js+1.34.7.patch`, applied
  by the `postinstall` script via `patch-package` — don't drop that script, and
  re-run `npx patch-package whatsapp-web.js` if you ever edit the patched file).
  `processMediaData()` returns a WhatsApp *model*, so spreading it into the
  outgoing message in `src/util/Injected/Utils.js` leaked `__x_id` and a
  `toJSON()` `id` over the real `id: newMsgKey`, and every media send died with
  "Data passed to getter must include an id property (it's how we memoize) but
  got undefined". The patch re-asserts the key after the spreads. Text sends
  were never affected. Bumping the dependency means regenerating the patch —
  and checking upstream fixed it first.
- A card that won't send falls back to the text wish (`sendWish` in
  `engine.js`, `card_fallback` event) instead of counting as a failed send.
  Without that, a WhatsApp-side media breakage aborts the whole run on the
  second person via `maxConsecutiveFailures`.
- Unhandled rejections from whatsapp-web.js teardown are logged, not fatal.
- UI shows errors via `friendlyError()` in `src/ui/errors.js` (strips the IPC
  wrapper, maps known errors to plain language) — never render `err.message` raw.
- WhatsApp teardown is serialized in `whatsappManager` (`_teardown`): every
  connect waits for the previous browser to exit, or launch fails with
  "browser is already running". A LOGOUT (unlinked from phone, at runtime or
  on connect) clears the saved session so the next connect shows a fresh QR.
- Anti-ban behavior is a core requirement: always validate numbers are on
  WhatsApp before sending, respect quiet hours / daily cap (`dailyCapMax`
  150) / warm-up, abort after `maxConsecutiveFailures`. Manual sends get the
  same pacing (only start jitter is skipped). No real send before
  `riskAcknowledged`.
- Hold a module-level reference to any Electron `Notification` that has a
  click handler, or it can be garbage collected and the click is lost.
- Tests:
  - The in-memory DB fixtures don't enable `PRAGMA foreign_keys`. Turn it on
    in any test touching deletes (the real DB has it on).
  - `renderMessage` appends a random emoji about 60% of the time, so assert
    message text with a prefix match, not equality.
- SheetJS `xlsx` is the 0.20.x build from cdn.sheetjs.com (the npm 0.18.5 has unfixed CVEs). Its ESM build needs `XLSX.set_fs(fs)` before any `readFile`/`writeFile` (done in `xlsx.js` and `progress.js`).
- Start-at-login on Windows is a **Startup-folder shortcut** with `--hidden` (`applyRunAtLogin` in `main.js`), only for the packaged app. Electron's own Run-registry login item was never executed by Windows on the test machine (its startup log listed every other Run entry and skipped ours). The old Run entry is removed on each launch.
- The tray icon ships as an extra resource (`build/tray-icon.png` is not in `app.asar`); `tray.js` falls back to an embedded copy so the tray is never blank.
- `whatsappManager.connect()` health-checks a "ready" client (`clientHealth.js`) and watches the browser process, because whatsapp-web.js emits no event when its browser dies.
- Known rough edges:
  - `--no-sandbox` is passed to the system browser, and `wa-session/` is stored unencrypted in userData.
  - A network error during the "is this number on WhatsApp?" lookup counts as a failed send (2 in a row abort the run) -- deliberate anti-ban behavior.
  - Runs recorded under a wrong system clock keep their wrong dates.
  - Icons are placeholders, and the installer is unsigned.
- Never commit `*.sqlite*`, `wa-session/`, `.wwebjs_*` (see `.gitignore`).
