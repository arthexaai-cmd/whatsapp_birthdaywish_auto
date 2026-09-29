import React, { useState } from "react";
import { friendlyError } from "../errors.js";

// Settings → "Reset everything". Irreversible, so it takes three deliberate
// steps: open the panel, type RESET, press the button. Offers an export of
// the report first, since the send history is deleted too.
export default function ResetCard() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [exported, setExported] = useState(null);

  const exportFirst = async () => {
    setError(null);
    try {
      const filePath = await window.api.reports.export(365);
      if (filePath) setExported(filePath);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      // On success the app wipes its data and restarts, so this never returns.
      await window.api.settings.factoryReset();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="card stack" style={{ borderColor: "var(--danger)" }}>
      <h3 style={{ margin: 0 }}>Reset everything</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Deletes all contacts, messages, settings and send history, and unlinks WhatsApp. The app then restarts at the
        setup wizard, as if freshly installed. This can&apos;t be undone.
      </p>

      {!open ? (
        <button className="danger" onClick={() => setOpen(true)} style={{ alignSelf: "flex-start" }}>
          Reset everything…
        </button>
      ) : (
        <div className="stack">
          <div className="row">
            <button onClick={exportFirst} disabled={busy}>
              Export report first (recommended)
            </button>
            {exported && <span className="muted" style={{ fontSize: 12 }}>Saved to {exported}</span>}
          </div>
          <div>
            <label>
              Type <strong>RESET</strong> to confirm
            </label>
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoFocus />
          </div>
          <div className="row">
            <button className="danger" onClick={reset} disabled={typed !== "RESET" || busy}>
              {busy ? "Resetting…" : "Delete everything and restart"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
