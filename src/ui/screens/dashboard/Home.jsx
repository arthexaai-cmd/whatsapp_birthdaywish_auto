import React, { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "../../errors.js";
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

function describeWaProblem(error) {
  if (error === "unlinked") {
    return "This computer was unlinked from WhatsApp on your phone. Birthday messages can't be sent until you reconnect by scanning a new QR code.";
  }
  const detail = error ? ` (${friendlyError(new Error(error))})` : "";
  return `WhatsApp isn't connected, so birthday messages can't be sent until you reconnect${detail}.`;
}

export default function Home({ settings, waState, onReopenWizard, onSettingsChange }) {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);
  const [ignoreLedger, setIgnoreLedger] = useState(false);
  const [clockDrift, setClockDrift] = useState(null);
  const [preview, setPreview] = useState(null);
  const logRef = useRef(null);

  const loadPreview = useCallback(() => {
    window.api.run
      .previewToday({ ignoreLedger })
      .then(setPreview)
      .catch((err) => setError(friendlyError(err)));
  }, [ignoreLedger]);
  // Listeners registered once on mount call through this ref, so they always
  // use the current ignoreLedger rather than the value at mount time.
  const loadPreviewRef = useRef(loadPreview);
  loadPreviewRef.current = loadPreview;

  // `settings` is a dependency so the review list re-renders its messages as
  // soon as any setting changes (e.g. the name postfix), not only on mount.
  useEffect(() => {
    loadPreview();
  }, [loadPreview, settings]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await onSettingsChange?.();
      await window.api.run.previewToday({ ignoreLedger }).then(setPreview);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const off = window.api.run.onProgress((event) => {
      setEvents((prev) => [...prev.slice(-200), event]);
      if (event.phase === "complete" || event.phase === "cancelled") {
        setRunning(false);
        loadPreviewRef.current();
      }
    });
    window.api.run.isActive().then(setRunning);
    // The tray's "Send today's birthdays" only brings this screen up for
    // review -- it never sends without someone pressing Send here.
    const offRunNow = window.api.tray.onRunNow(() => loadPreviewRef.current());
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

  const due = preview?.due ?? [];
  const auto = settings?.sendMode === "auto";

  const startRun = async (dryRun) => {
    if (!dryRun) {
      const ok = window.confirm(
        `Send ${due.length} birthday message${due.length === 1 ? "" : "s"} on WhatsApp now?\n\n` +
          "They go out spaced a little apart, so keep the app open until it finishes."
      );
      if (!ok) return;
    }
    // Send exactly what was reviewed: only these people, with this text.
    const approved = Object.fromEntries(due.map((d) => [d.ledgerKey, d.text]));
    setError(null);
    setEvents([]);
    setLastResult(null);
    setRunning(true);
    try {
      const result = await window.api.run.start({ dryRun, ignoreLedger, approved });
      setLastResult(result);
    } catch (err) {
      setError(friendlyError(err));
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

      {(waState?.status === "disconnected" || waState?.status === "error") && (
        <div className="card row" style={{ justifyContent: "space-between", borderColor: "var(--danger)" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>{describeWaProblem(waState.error)}</p>
          <button className="primary" onClick={onReopenWizard}>
            Reconnect
          </button>
        </div>
      )}

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
            <h3 style={{ margin: 0 }}>Today&apos;s birthdays</h3>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {auto
                ? `Automatic — sends daily from ${settings?.scheduledTime}`
                : settings?.reminderEnabled === false
                  ? "Manual — review and send from here"
                  : `Manual — review and send from here (reminder at ${settings?.scheduledTime})`}
              {settings?.schedulingPaused && <span style={{ color: "var(--warn)" }}> — paused</span>}
            </p>
          </div>
          <div className="row">
            <button onClick={refreshAll} disabled={running || refreshing} title="Reload settings, today's birthdays and their messages">
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            {running ? (
              <button className="danger" onClick={cancel}>
                Stop
              </button>
            ) : (
              <>
                <button onClick={() => startRun(true)} disabled={due.length === 0}>
                  Dry run
                </button>
                <button
                  className="primary"
                  onClick={() => startRun(false)}
                  disabled={waState?.status !== "ready" || due.length === 0}
                  title={waState?.status !== "ready" ? "Connect WhatsApp first" : undefined}
                >
                  {auto ? "Send now" : "Send all"}
                  {due.length > 0 ? ` (${due.length})` : ""}
                </button>
              </>
            )}
          </div>
        </div>

        {preview && due.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            {preview.alreadySentToday.length > 0 ? "Everyone's been sent to today. 🎉" : "No birthdays to send today."}
          </p>
        )}
        {due.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {due.map((d) => (
                <tr key={d.ledgerKey}>
                  <td>
                    {d.name}
                    {d.belated && (
                      <span className="badge warn" style={{ marginLeft: 6 }} title={`Birthday was ${d.occurrence}`}>
                        belated
                      </span>
                    )}
                  </td>
                  <td className="muted">{d.phone}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{d.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview?.overCap > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--warn)" }}>
            The daily cap is {preview.cap}, so {preview.overCap} of these will wait for the next send (as belated wishes).
          </p>
        )}
        {preview?.alreadySentToday.length > 0 && due.length > 0 && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Already sent today: {preview.alreadySentToday.map((s) => s.name).join(", ")}
          </p>
        )}
        {!running && (
          <label className="row" style={{ cursor: "pointer", fontSize: 12 }}>
            <input type="checkbox" checked={ignoreLedger} onChange={(e) => setIgnoreLedger(e.target.checked)} />
            <span className="muted">
              Ignore send history (testing only) — also lists people you already messaged today, so they get a duplicate message
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
    case "scheduled": {
      const base = `Scheduled ${e.scheduledCount} send(s)${e.droppedByCap ? `, ${e.droppedByCap} deferred by daily cap` : ""}.`;
      if (!e.firstSendAt || e.scheduledCount === 0) return base;
      const firstAt = new Date(e.firstSendAt);
      const waitMs = firstAt.getTime() - Date.now();
      const waitLabel = waitMs > 30_000 ? ` (in about ${Math.round(waitMs / 60_000)} min)` : "";
      return `${base} First send at ${firstAt.toLocaleTimeString()}${waitLabel}.`;
    }
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
