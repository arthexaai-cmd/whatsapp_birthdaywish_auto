// Post-run reporting: builds the plain-text summary sent to the user's own
// WhatsApp number and the structured data the DB layer persists. Pure and
// side-effect free -- writing to SQLite is the DB layer's job (electron/db.js),
// not this module's.

export function buildSummary(results, runStart, runEnd, timezone = "Asia/Kolkata") {
  const sent = results.filter((r) => r.status === "sent");
  const failed = results.filter((r) => r.status === "failed");
  const notOnWhatsapp = results.filter((r) => r.status === "not_on_whatsapp");
  const belated = sent.filter((r) => r.belated);
  const fmtTime = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });

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

export function maskPhone(e164) {
  return e164.length > 4 ? `${e164.slice(0, -4).replace(/\d/g, "•")}${e164.slice(-4)}` : e164;
}
