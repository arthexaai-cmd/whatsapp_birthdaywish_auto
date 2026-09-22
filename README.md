# WhatsApp Birthday Bot

Sends birthday wishes over WhatsApp Web on a daily schedule, reading a roster
from Google Sheets, with human-like pacing to avoid WhatsApp's spam
detection. Scheduled and manually triggerable via GitHub Actions, running on
a **self-hosted runner on your own laptop**.

See [`.claude/plans`](#) or ask your assistant for the original design plan
(architecture rationale, risk notes) — this README is the operational guide.

## Why a self-hosted runner, not GitHub-hosted

WhatsApp Web's session lives in browser storage that doesn't survive across
machines, and GitHub-hosted runners use a different datacenter IP every run.
Both get the account logged out or flagged fast. A self-hosted runner on
your laptop keeps a persistent session and a stable home IP, while the
`cron` schedule and the manual "Run workflow" button still live on GitHub
exactly as normal.

**Bonus:** if the laptop is closed when the schedule fires, the job simply
queues on GitHub and runs automatically the moment the runner reconnects.
Combined with the catch-up window (below), nothing gets missed.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Google Sheet

Create a sheet with these columns in the header row (case-insensitive, any
order, extra columns ignored):

| name | phone | birthdate | custom_message | skip | salutation |
|---|---|---|---|---|---|

- `birthdate`: `DD/MM/YYYY`, `DD/MM`, or a real date cell.
- `custom_message`: optional, sent verbatim (only `{name}` is substituted) instead of the template pool.
- `skip`: any truthy value (`yes`, `true`, `1`) permanently excludes the row.
- `salutation`: optional, used instead of the derived first name.

Create a Google Cloud service account, enable the Sheets API, download its
JSON key, and **share the sheet with the service account's email** as
Viewer.

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in `GSHEET_ID` (from the sheet's URL), `GSHEET_TAB`, and point
`GOOGLE_APPLICATION_CREDENTIALS` at the downloaded key JSON (keep it out of
git — it's already gitignored). Set `SELF_NOTIFY_NUMBER` to get a WhatsApp
summary after each run.

### 4. Pair WhatsApp (one-time, interactive)

```bash
npm run login
```

Scan the QR with WhatsApp on your phone → Linked devices → Link a device.
The session persists under `%USERPROFILE%\.wa-birthday-bot\session` and is
reused by every future run — no need to scan again unless you unlink the
device.

### 5. Preflight check

```bash
npm run doctor
```

Validates config, reaches the sheet, reports any bad rows by number, shows
today's matches, and prints sample rendered messages — **without sending
anything**.

### 6. Dry run

```bash
npm run dry
```

Prints the exact schedule (who, when, what text) that a real run would
send. Still sends nothing.

### 7. Go live, staged

Per the plan: test with your own number only, then a few friendly numbers,
then the real sheet with the automatic warm-up ramp (`config/config.yaml`)
keeping the first week's volume low.

## Running it

- **Automatically**: the GitHub Actions schedule (`.github/workflows/birthday.yml`), once the self-hosted runner is installed as a Windows service on this machine.
- **Manually from anywhere (including your phone)**: GitHub → Actions → "Birthday bot" → "Run workflow". Use the `dry_run` input to test without sending.
- **Manually on the laptop**: `powershell -File scripts/run-now.ps1` (see its header comment for flags: `-DryRun`, `-Date`, `-IgnoreLedger`).

## Self-hosted runner setup (one-time)

1. GitHub repo → Settings → Actions → Runners → New self-hosted runner (Windows).
2. Follow GitHub's generated `config.cmd` steps, labeling the runner `whatsapp` (matches `runs-on: [self-hosted, windows, whatsapp]` in the workflow).
3. Install it as a service so it survives reboots and doesn't need you logged in: `./svc install` then `./svc start` (from the runner's install directory, as shown in GitHub's instructions).
4. Keep the repo **private** — a self-hosted runner on a public repo is a known code-execution risk via fork PRs.

## Secrets to set on the repo (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `GOOGLE_SA_KEY` | full contents of the service-account key JSON |
| `GSHEET_ID` | the sheet id |
| `SELF_NOTIFY_NUMBER` | your number in E.164, e.g. `+919999999999` |

| Variable | Value |
|---|---|
| `GSHEET_TAB` | the tab name (optional, defaults to the first tab) |

## Tuning pacing / anti-ban behavior

All in `config/config.yaml` under `pacing:` — batch sizes, gaps, typing
delay, daily cap, quiet hours, and the warm-up ramp for a fresh number. See
the plan doc for the reasoning behind each default.

## Tests

```bash
npm test
```

Covers date/phone parsing, birthday matching (including Feb 29 and
year-boundary catch-up), ledger dedupe, quiet-hours, and message rendering
— all pure functions, no WhatsApp or network involved.

## Risk notes

Bulk automated WhatsApp sends carry real ban risk even with this bot's
mitigations (number validation, message variation, human-like pacing, warm-up
ramp, quiet hours). Use a number you can afford to lose. See the plan's
"Risk reality check" section for detail, and consider the official WhatsApp
Cloud API if this needs to be bulletproof.
