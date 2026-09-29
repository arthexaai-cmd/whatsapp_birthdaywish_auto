import React, { useCallback, useEffect, useState } from "react";
import { friendlyError } from "../../errors.js";

// Kept in sync with STATUS_LABELS in src/core/progress.js (not imported:
// that module pulls in xlsx, which doesn't belong in the renderer bundle).
const STATUS = {
  sent: { label: "Sent", cls: "ok" },
  failed: { label: "Failed", cls: "danger" },
  not_on_whatsapp: { label: "Not on WhatsApp", cls: "danger" },
  scheduled: { label: "Scheduled", cls: "" },
  catch_up: { label: "Belated catch-up", cls: "warn" },
  pending_retry: { label: "Pending retry", cls: "warn" },
};

const RANGES = [
  { days: 7, label: "Next 7 days" },
  { days: 30, label: "Next 30 days" },
  { days: 90, label: "Next 90 days" },
  { days: 365, label: "Next 12 months" },
];

function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, cls: "" };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

function Stat({ label, value }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 110, padding: "10px 14px" }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function formatDay(ymd, today) {
  if (ymd === today) return "Today";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function Reports() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [savedTo, setSavedTo] = useState(null);

  const load = useCallback(() => {
    window.api.reports
      .get(days)
      .then((r) => {
        setReport(r);
        setError(null);
      })
      .catch((err) => setError(friendlyError(err)));
  }, [days]);

  useEffect(() => {
    load();
    // Refresh when a run finishes so progress/upcoming reflect the new sends.
    const off = window.api.run.onProgress((event) => {
      if (event.phase === "complete" || event.phase === "cancelled") load();
    });
    return () => off();
  }, [load]);

  const exportReport = async () => {
    setExporting(true);
    setSavedTo(null);
    setError(null);
    try {
      const filePath = await window.api.reports.export(days);
      if (filePath) setSavedTo(filePath);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setExporting(false);
    }
  };

  if (!report) {
    return (
      <div className="stack">
        <h1>Reports</h1>
        {error ? <div className="card" style={{ borderColor: "var(--danger)" }}>{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const { progress, upcoming } = report;
  const { totals } = progress;
  const { meta } = upcoming;
  const due = upcoming.rows.filter((r) => r.status !== "sent" && r.status !== "not_on_whatsapp");

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Reports</h1>
        <div className="row">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="primary" onClick={exportReport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>
      </div>

      {savedTo && (
        <div className="card muted" style={{ fontSize: 13 }}>
          Report saved to {savedTo}
        </div>
      )}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="row" style={{ flexWrap: "wrap" }}>
        <Stat label="Sent so far" value={totals.sent} />
        <Stat label="Belated" value={totals.belatedSent} />
        <Stat label="Failed" value={totals.failed} />
        <Stat label="Not on WhatsApp" value={totals.notOnWhatsapp} />
        <Stat label="Due in range" value={due.length} />
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Upcoming schedule</h3>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          {meta.sendMode === "auto"
            ? `Sent automatically each day from ${meta.scheduledTime} (${meta.timezone}). Exact send times are spread out randomly after that to look human, so only the day is fixed.`
            : "Manual mode: each day's messages go out when you press Send all on the Dashboard."}
        </p>
        {meta.paused && meta.sendMode === "auto" && (
          <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>
            Automatic sending is paused — nothing below will send until you turn it back on (Schedule tab).
          </p>
        )}
        {meta.overCapDays.length > 0 && (
          <p style={{ margin: 0, color: "var(--warn, var(--danger))", fontSize: 13 }}>
            Some days have more birthdays than the current daily cap ({meta.dailyCap}); the extras are sent as belated
            wishes on following days, or missed once they fall outside the catch-up window.
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Turning</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.rows.map((r) => (
              <tr key={`${r.contactId}:${r.occurrence}`}>
                <td>
                  {formatDay(r.sendDate, meta.today)}
                  {r.overCap && (
                    <span className="badge warn" style={{ marginLeft: 6 }} title="More birthdays than the daily cap">
                      over cap
                    </span>
                  )}
                </td>
                <td>{r.name}</td>
                <td className="muted">{r.phone}</td>
                <td className="muted">{r.turning ?? ""}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
            {upcoming.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No birthdays in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {upcoming.skipped.length > 0 && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {upcoming.skipped.length} contact{upcoming.skipped.length === 1 ? " is" : "s are"} marked skip and never
            messaged (listed in the export).
          </p>
        )}
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Sent so far</h3>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          {totals.runsCompleted} completed run{totals.runsCompleted === 1 ? "" : "s"}
          {totals.runsCancelled ? `, ${totals.runsCancelled} cancelled` : ""} · {totals.contacts} contacts
        </p>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Belated</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {progress.sends.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.sentAt).toLocaleString()}</td>
                  <td>{s.name}</td>
                  <td className="muted">{s.phone}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="muted">{s.belated ? "Yes" : ""}</td>
                  <td className="muted">{s.error || ""}</td>
                </tr>
              ))}
              {progress.sends.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nothing sent yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
