import React, { useEffect, useRef, useState } from "react";

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
      const result = await window.api.run.start({ dryRun });
      setLastResult(result);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => window.api.run.cancel();

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Dashboard</h1>
        <StatusBadge waState={waState} />
      </div>

      <div className="card row" style={{ justifyContent: "space-between" }}>
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
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{lastResult.summary.text}</pre>
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
