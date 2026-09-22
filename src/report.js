// Post-run reporting: a WhatsApp summary to yourself, a dated JSON log
// under BOT_HOME/logs, and a GitHub Actions job-summary table when running
// in CI (GITHUB_STEP_SUMMARY is set).

import fs from "node:fs";
import path from "node:path";

export function buildSummary(results, runStart, runEnd) {
  const sent = results.filter((r) => r.status === "sent");
  const failed = results.filter((r) => r.status === "failed");
  const notOnWhatsapp = results.filter((r) => r.status === "not_on_whatsapp");
  const belated = sent.filter((r) => r.belated);
  const fmtTime = (d) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

  const lines = [
    `🎂 Birthday bot — ${runStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`,
    `Sent ${sent.length} · Failed ${failed.length} · Not on WhatsApp ${notOnWhatsapp.length} · Belated ${belated.length}`,
    `Window ${fmtTime(runStart)}–${fmtTime(runEnd)}`,
  ];
  for (const f of failed) {
    lines.push(`⚠️ ${f.person.name} (${maskPhone(f.person.phoneE164)}) — ${f.reason || "send failed"}`);
  }
  return { text: lines.join("\n"), sent, failed, notOnWhatsapp, belated };
}

function maskPhone(e164) {
  return e164.length > 4 ? `${e164.slice(0, -4).replace(/\d/g, "•")}${e164.slice(-4)}` : e164;
}

export function writeJsonLog(logsDir, dateKey, payload) {
  const file = path.join(logsDir, `${dateKey}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

export function writeGithubJobSummary(summaryText, results) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const rows = results
    .map((r) => `| ${r.person.name} | ${maskPhone(r.person.phoneE164)} | ${r.status} | ${r.belated ? "yes" : "no"} |`)
    .join("\n");
  const md = [
    "## Birthday bot run",
    "```",
    summaryText,
    "```",
    "",
    "| Name | Phone | Status | Belated |",
    "|---|---|---|---|",
    rows,
    "",
  ].join("\n");
  fs.appendFileSync(file, md, "utf8");
}
