// Preflight check, run before trusting the bot with real sends:
//   npm run doctor
// Validates config, reaches the roster source, reports per-row parse
// failures, and renders sample messages -- all without touching WhatsApp.

import fs from "node:fs";
import { config, assertConfigSane } from "../src/config.js";
import { loadRoster } from "../src/loadRoster.js";
import { renderMessage } from "../src/messages.js";
import { matchBirthdays } from "../src/birthdays.js";

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  let ok = true;

  section("Config");
  const problems = assertConfigSane();
  if (problems.length) {
    ok = false;
    problems.forEach((p) => console.log(`  ✗ ${p}`));
  } else {
    console.log("  ✓ config looks sane");
  }
  console.log(`  roster source: ${config.roster.source}`);
  console.log(`  timezone: ${config.timezone}`);
  console.log(`  BOT_HOME: ${config.paths.botHome}`);

  section("WhatsApp session");
  const sessionMarker = fs.existsSync(config.paths.sessionDir) && fs.readdirSync(config.paths.sessionDir).length > 0;
  if (sessionMarker) {
    console.log(`  ✓ session directory exists and is non-empty (${config.paths.sessionDir})`);
  } else {
    ok = false;
    console.log(`  ✗ no session found at ${config.paths.sessionDir} -- run \`npm run login\` first`);
  }

  section("Roster");
  try {
    const { people, errors, skipped } = await loadRoster(config);
    console.log(`  ✓ loaded ${people.length} people, ${skipped.length} skipped, ${errors.length} row errors`);
    if (errors.length) {
      ok = false;
      errors.slice(0, 20).forEach((e) => console.log(`  ✗ row ${e.rowNum}: ${e.reason}${e.name ? ` (${e.name})` : ""}`));
      if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`);
    }

    section("Today's matches (with catch-up window)");
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = fmt.formatToParts(now);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const today = { year: get("year"), month: get("month"), day: get("day") };
    const matches = matchBirthdays(people, today, {
      catchupDays: config.selection.catchupDays,
      leapDayFallback: config.roster.leapDayFallback,
    });
    console.log(`  ${matches.length} match(es) for ${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`);
    matches.forEach((m) => console.log(`  - ${m.person.name} (${m.person.phoneE164})${m.belated ? " [belated]" : ""}`));

    section("Sample rendered messages (not sent)");
    const sample = people.slice(0, 5);
    for (const p of sample) {
      console.log(`  ${p.name}: "${renderMessage(p, false, config.messages)}"`);
    }
    for (let i = 0; i < 5; i++) {
      console.log(`  [belated sample ${i + 1}]: "${renderMessage({ firstName: "Alex", salutation: null }, true, config.messages)}"`);
    }
  } catch (err) {
    ok = false;
    console.log(`  ✗ failed to load roster: ${err.message}`);
  }

  section("Result");
  console.log(ok ? "  ✓ all checks passed" : "  ✗ some checks failed -- see above");
  process.exit(ok ? 0 : 1);
}

main();
