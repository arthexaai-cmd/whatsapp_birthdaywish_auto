import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import YAML from "yaml";

dotenv.config();

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readYaml(relPath) {
  const p = path.join(repoRoot, relPath);
  const raw = fs.readFileSync(p, "utf8");
  return YAML.parse(raw);
}

const configYaml = readYaml("config/config.yaml");
const messagesYaml = readYaml("config/messages.yaml");

// BOT_HOME must live outside the repo workspace: GitHub Actions wipes the
// workspace on every checkout, which would destroy the WhatsApp session and
// the sent-ledger if either lived inside the repo.
const botHome = process.env.BOT_HOME || path.join(os.homedir(), ".wa-birthday-bot");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

const paths = {
  botHome: ensureDir(botHome),
  sessionDir: ensureDir(path.join(botHome, "session")),
  stateDir: ensureDir(path.join(botHome, "state")),
  logsDir: ensureDir(path.join(botHome, "logs")),
  ledgerFile: path.join(botHome, "state", "ledger.jsonl"),
};

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const config = {
  repoRoot,
  paths,
  dryRun: boolEnv("DRY_RUN", false),
  timezone: configYaml.timezone || "Asia/Kolkata",

  roster: {
    source: process.env.ROSTER_SOURCE || "gsheet",
    defaultCountry: configYaml.roster?.defaultCountry || "IN",
    leapDayFallback: configYaml.roster?.leapDayFallback || "feb28",
    gsheet: {
      sheetId: process.env.GSHEET_ID || "",
      tab: process.env.GSHEET_TAB || "",
      credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || "./google-service-account.json",
    },
    xlsx: {
      path: process.env.XLSX_PATH || "./data/birthdays.xlsx",
      sheet: process.env.XLSX_SHEET || "",
    },
  },

  selection: {
    catchupDays: configYaml.selection?.catchupDays ?? 2,
  },

  pacing: {
    startJitterMinutes: configYaml.pacing?.startJitterMinutes ?? [0, 75],
    batchSize: configYaml.pacing?.batchSize ?? [4, 7],
    withinBatchSeconds: configYaml.pacing?.withinBatchSeconds ?? [40, 150],
    betweenBatchMinutes: configYaml.pacing?.betweenBatchMinutes ?? [14, 28],
    typingMsPerChar: configYaml.pacing?.typingMsPerChar ?? [45, 90],
    dailyCap: configYaml.pacing?.dailyCap ?? 60,
    quietHours: configYaml.pacing?.quietHours ?? ["21:30", "08:30"],
    warmupDays: configYaml.pacing?.warmupDays ?? 7,
    warmupStartCap: configYaml.pacing?.warmupStartCap ?? 8,
  },

  retry: {
    maxConsecutiveFailures: configYaml.retry?.maxConsecutiveFailures ?? 2,
    retryBackoffSeconds: configYaml.retry?.retryBackoffSeconds ?? [60, 120],
  },

  messages: messagesYaml,

  selfNotifyNumber: process.env.SELF_NOTIFY_NUMBER || "",
};

export function assertConfigSane() {
  const problems = [];
  if (config.roster.source === "gsheet" && !config.roster.gsheet.sheetId) {
    problems.push("ROSTER_SOURCE=gsheet but GSHEET_ID is not set.");
  }
  if (config.roster.source === "xlsx" && !fs.existsSync(config.roster.xlsx.path)) {
    problems.push(`ROSTER_SOURCE=xlsx but file not found: ${config.roster.xlsx.path}`);
  }
  if (!Array.isArray(config.messages.onTime) || config.messages.onTime.length === 0) {
    problems.push("config/messages.yaml has no onTime templates.");
  }
  if (!Array.isArray(config.messages.belated) || config.messages.belated.length === 0) {
    problems.push("config/messages.yaml has no belated templates.");
  }
  return problems;
}
