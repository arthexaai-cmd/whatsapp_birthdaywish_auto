import React, { useEffect, useRef, useState } from "react";
import { describeDrift } from "../../../core/clock.js";

function StatusBadge({ waState }) {
  const map = {
    ready: { cls: "ok", label: "WhatsApp connected" },
    connecting: { cls: "warn", label: "Connecting…" },
    qr: { cls: "warn", label: "Waiting for QR scan" },
    disconnected: { cls: "danger", label: "WhatsApp disconnected" },
    error: { cls: "danger", label: "WhatsApp error" },
  };
  const s = map[waState?.status] || map.disconnected;
  return (
    <span className={`badge ${s.cls}`}>
      <span className="dot" />
      {s.label}
    </span>
  );
}

export default function Home({ settings, waState }) {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);
  const [ignoreLedger, setIgnoreLedger] = useState(false);
  const [clockDrift, setClockDrift] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    const off = window.api.run.onProgress((event) => {
      setEvents((prev) => [...prev.slice(-200), event]);
      if (event.phase === "complete" || event.phase === "cancelled") {
        setRunning(false);
      }
    });
    window.api.run.isActive().then(setRunning);
    const offRunNow = window.api.tray.onRunNow(() => startRun(false));
    // Quiet, best-effort check -- birthday matching and scheduling read
    // entirely from the system clock, so a wrong clock fails silently
    // otherwise. Only surfaces a banner if it's actually off; never blocks
    // anything if the check itself fails (e.g. no internet).
    window.api.clock.check().then((r) => {
      if (r?.ok === false) setClockDrift(r);
    });
    return () => {
      off();
      offRunNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [events]);

  const startRun = async (dryRun) => {
    setError(null);
    setEvents([]);
    setLastResult(null);
    setRunning(true);
    try {
      const result = await window.api.run.start({ dryRun, ignoreLedger });
      setLastResult(result);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => window.api.run.cancel();
  const openClockSettings = () => window.api.clock.openDateTimeSettings();

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Dashboard</h1>
        <StatusBadge waState={waState} />
      </div>

      {clockDrift && (
        <div className="card row" style={{ justifyContent: "space-between", borderColor: "var(--danger)" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>
            ⚠ This computer's clock appears to be off by about {describeDrift(clockDrift.driftMs)}. Birthday matching
            and the daily schedule depend on it being correct.
          </p>
          <button onClick={openClockSettings}>Fix clock</button>
        </div>
      )}

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h3 style={{ margin: 0 }}>Send today&apos;s birthdays</h3>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Scheduled daily at {settings?.scheduledTime} ({settings?.timezone})
              {settings?.schedulingPaused && <span style={{ color: "var(--warn)" }}> — scheduling paused</span>}
            </p>
          </div>
          <div className="row">
            {running ? (
              <button className="danger" onClick={cancel}>
                Stop
              </button>
            ) : (
              <>
                <button onClick={() => startRun(true)}>Dry run</button>
                <button className="primary" onClick={() => startRun(false)} disabled={waState?.status !== "ready"}>
                  Run now
                </button>
              </>
            )}
          </div>
        </div>
        {!running && (
          <label className="row" style={{ cursor: "pointer", fontSize: 12 }}>
            <input type="checkbox" checked={ignoreLedger} onChange={(e) => setIgnoreLedger(e.target.checked)} />
            <span className="muted">
              Ignore send history (testing only) — resend to people already messaged today instead of skipping them
            </span>
          </label>
        )}
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>
        </div>
      )}

      {(running || events.length > 0) && (
        <div className="card">
          <h3>Live progress</h3>
          <div ref={logRef} className="stack" style={{ maxHeight: 280, overflowY: "auto", fontSize: 13 }}>
            {events.map((e, i) => (
              <div key={i} className="muted">
                {describeEvent(e)}
              </div>
            ))}
          </div>
        </div>
      )}

      {lastResult && !running && (
        <div className="card">
          <h3>Last run</h3>
          {lastResult.summary ? (
            // A real send: summary.text is the actual sent/failed/skipped report.
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{lastResult.summary.text}</pre>
          ) : lastResult.scheduled?.length > 0 ? (
            // A dry run that found matches: summary is always null for dry runs
            // (it's only built after a real send), so show the preview instead
            // of falling through to "nothing matched" -- nothing was sent.
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>
                Dry run — nothing was sent. {lastResult.scheduled.length} message(s) would go out:
              </p>
              {lastResult.scheduled.map((p, i) => (
                <div key={i} className="muted">
                  {p.belated ? "[belated] " : ""}
                  {p.person.name} at {new Date(p.sendAt).toLocaleTimeString()} — &quot;{p.text}&quot;
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No matching birthdays today.</p>
          )}
        </div>
      )}
    </div>
  );
}

function describeEvent(e) {
  switch (e.phase) {
    case "loaded":
      return `Loaded ${e.contactCount} contacts.`;
    case "matched":
      return `${e.matchCount} birthday(s) matched.`;
    case "scheduled":
      return `Scheduled ${e.scheduledCount} send(s)${e.droppedByCap ? `, ${e.droppedByCap} deferred by daily cap` : ""}.`;
    case "dry_run_complete":
      return `Dry run: ${e.preview.length} message(s) would be sent. ${e.preview
        .map((p) => `${p.person.name} at ${new Date(p.sendAt).toLocaleTimeString()}`)
        .join(" · ")}`;
    case "sending":
      return `Sending to ${e.person.name}…`;
    case "sent":
      return `✓ Sent to ${e.person.name}`;
    case "not_on_whatsapp":
      return `– Skipped ${e.person.name} (not on WhatsApp)`;
    case "send_failed":
      return `✗ Failed for ${e.person.name}: ${e.error}`;
    case "aborted_consecutive_failures":
      return `Run stopped after ${e.consecutiveFailures} consecutive failures.`;
    case "complete":
      return "Run complete.";
    case "cancelled":
      return "Run cancelled.";
    default:
      return e.phase;
  }
}
