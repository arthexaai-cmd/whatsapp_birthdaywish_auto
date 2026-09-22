// Orchestrator: load roster -> match birthdays -> dedupe vs ledger ->
// build a paced schedule -> send (or dry-run) -> report.

import { config, assertConfigSane } from "./config.js";
import { loadRoster } from "./loadRoster.js";
import { matchBirthdays, dedupeAgainstLedger } from "./birthdays.js";
import { renderMessage } from "./messages.js";
import { batchMatches, buildSchedule, sleep } from "./pacing.js";
import { loadLedgerKeys, appendLedgerEntry, countLedgerDays } from "./state.js";
import { createClient, resolveWhatsappId, sendWithTyping } from "./whatsapp.js";
import { buildSummary, writeJsonLog, writeGithubJobSummary } from "./report.js";

function parseArgs(argv) {
  const args = { date: null, ignoreLedger: false };
  for (const a of argv) {
    if (a.startsWith("--date=")) args.date = a.slice("--date=".length);
    if (a === "--ignore-ledger") args.ignoreLedger = true;
  }
  return args;
}

function todayInTz(tz, override) {
  if (override) {
    const [y, m, d] = override.split("-").map(Number);
    return { year: y, month: m, day: d };
  }
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runStart = new Date();

  const problems = assertConfigSane();
  if (problems.length) {
    console.error("Config problems:\n" + problems.map((p) => ` - ${p}`).join("\n"));
    process.exit(1);
  }

  console.log(`[birthday-bot] dryRun=${config.dryRun} timezone=${config.timezone}`);
  const { people, errors, skipped } = await loadRoster(config);
  console.log(`[birthday-bot] roster: ${people.length} people, ${errors.length} row errors, ${skipped.length} skipped`);
  if (errors.length) {
    for (const e of errors) console.warn(`  row ${e.rowNum}: ${e.reason}${e.name ? ` (${e.name})` : ""}`);
  }

  const today = todayInTz(config.timezone, args.date);
  console.log(`[birthday-bot] today = ${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`);

  let matches = matchBirthdays(people, today, {
    catchupDays: config.selection.catchupDays,
    leapDayFallback: config.roster.leapDayFallback,
  });

  if (!args.ignoreLedger) {
    const sentKeys = await loadLedgerKeys(config.paths.ledgerFile);
    matches = dedupeAgainstLedger(matches, sentKeys);
  }

  console.log(`[birthday-bot] ${matches.length} birthday(s) to send after dedupe`);
  if (matches.length === 0) {
    console.log("[birthday-bot] nothing to do.");
    return;
  }

  const ledgerDays = await countLedgerDays(config.paths.ledgerFile);
  const { batches, cap, droppedByCap } = batchMatches(matches, config.pacing, ledgerDays);
  if (droppedByCap > 0) {
    console.warn(`[birthday-bot] daily cap (${cap}) reached; ${droppedByCap} recipient(s) deferred to a future run`);
  }
  const { scheduled, deferred } = buildSchedule(batches, config.pacing, runStart, config.timezone);
  console.log(
    `[birthday-bot] scheduled ${scheduled.length} send(s) across ${batches.length} batch(es); ` +
      `${deferred.length} deferred to quiet hours / a future run`
  );

  if (config.dryRun) {
    for (const { item, sendAt } of scheduled) {
      const text = renderMessage(item.person, item.belated, config.messages);
      console.log(`  ${sendAt.toISOString()}  ${item.person.name} (${item.person.phoneE164})  ${item.belated ? "[belated] " : ""}"${text}"`);
    }
    console.log("[birthday-bot] DRY_RUN: no messages were sent, ledger not updated.");
    return;
  }

  const client = await createClient({ sessionDir: config.paths.sessionDir });
  const results = [];
  let consecutiveFailures = 0;

  try {
    for (const { item, sendAt } of scheduled) {
      const waitMs = sendAt.getTime() - Date.now();
      if (waitMs > 0) await sleep(waitMs);

      const person = item.person;
      const text = renderMessage(person, item.belated, config.messages);

      try {
        const chatId = await resolveWhatsappId(client, person.phoneE164);
        if (!chatId) {
          appendLedgerEntry(config.paths.ledgerFile, {
            ledgerKey: item.ledgerKey,
            phoneE164: person.phoneE164,
            name: person.name,
            occurrence: item.occurrence && `${item.occurrence.year}-${String(item.occurrence.month).padStart(2, "0")}-${String(item.occurrence.day).padStart(2, "0")}`,
            status: "not_on_whatsapp",
            timestamp: new Date().toISOString(),
            belated: item.belated,
          });
          results.push({ person, belated: item.belated, status: "not_on_whatsapp" });
          consecutiveFailures = 0;
          continue;
        }

        await sendOnce(client, chatId, text, config.pacing.typingMsPerChar, config.retry);
        appendLedgerEntry(config.paths.ledgerFile, {
          ledgerKey: item.ledgerKey,
          phoneE164: person.phoneE164,
          name: person.name,
          occurrence: `${item.occurrence.year}-${String(item.occurrence.month).padStart(2, "0")}-${String(item.occurrence.day).padStart(2, "0")}`,
          status: "sent",
          timestamp: new Date().toISOString(),
          belated: item.belated,
        });
        results.push({ person, belated: item.belated, status: "sent" });
        consecutiveFailures = 0;
        console.log(`[birthday-bot] sent to ${person.name}`);
      } catch (err) {
        console.error(`[birthday-bot] send failed for ${person.name}: ${err.message}`);
        results.push({ person, belated: item.belated, status: "failed", reason: err.message });
        consecutiveFailures++;
        if (consecutiveFailures >= config.retry.maxConsecutiveFailures) {
          console.error(
            `[birthday-bot] ${consecutiveFailures} consecutive failures -- aborting run to protect the account. ` +
              `Remaining recipients will be retried on the next run.`
          );
          break;
        }
      }
    }
  } finally {
    await client.destroy().catch(() => {});
  }

  const runEnd = new Date();
  const summary = buildSummary(results, runStart, runEnd);
  console.log("\n" + summary.text);

  const dateKey = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  writeJsonLog(config.paths.logsDir, dateKey, {
    runStart: runStart.toISOString(),
    runEnd: runEnd.toISOString(),
    results,
    deferredCount: deferred.length,
    droppedByCap,
  });
  writeGithubJobSummary(summary.text, results);

  if (config.selfNotifyNumber) {
    try {
      const client2 = client; // reuse if still connected; otherwise this block is best-effort
      const chatId = await resolveWhatsappId(client2, config.selfNotifyNumber);
      if (chatId) await client2.sendMessage(chatId, summary.text);
    } catch (err) {
      console.warn(`[birthday-bot] could not send self-notify summary: ${err.message}`);
    }
  }

  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

async function sendOnce(client, chatId, text, typingRange, retryConfig) {
  try {
    await sendWithTyping(client, chatId, text, typingRange);
  } catch (err) {
    const [lo, hi] = retryConfig.retryBackoffSeconds;
    const backoffMs = (Math.floor(Math.random() * (hi - lo + 1)) + lo) * 1000;
    console.warn(`[birthday-bot] first attempt failed (${err.message}), retrying in ${Math.round(backoffMs / 1000)}s`);
    await sleep(backoffMs);
    await sendWithTyping(client, chatId, text, typingRange); // let a second failure propagate
  }
}

main().catch((err) => {
  console.error("[birthday-bot] fatal:", err);
  process.exitCode = 1;
});
