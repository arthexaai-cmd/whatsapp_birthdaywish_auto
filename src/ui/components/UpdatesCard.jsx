import React, { useState } from "react";
import { friendlyMessage } from "../errors.js";
import { useUpdateState, describeUpdate } from "../updates.js";

/** Settings → Updates: current version, check now, download/install, and the auto-check toggle. */
export default function UpdatesCard({ version, settings, onSettingsChange }) {
  const state = useUpdateState();
  const [blocked, setBlocked] = useState(null);

  const toggleAuto = async (enabled) => {
    await window.api.settings.set("updateCheckEnabled", enabled);
    onSettingsChange();
  };

  const install = async () => {
    setBlocked(null);
    const result = await window.api.updates.install();
    if (!result.ok) setBlocked(result.reason);
  };

  const status = state?.status;
  return (
    <div className="card stack">
      <h3>Updates</h3>
      <p className="muted" style={{ margin: 0 }}>
        Installed version: <strong>{version ?? "…"}</strong>
      </p>
      <p style={{ margin: 0 }}>{describeUpdate(state)}</p>
      {state?.error && <p style={{ margin: 0, color: "var(--danger)" }}>{friendlyMessage({ message: state.error })}</p>}
      {state?.releaseNotes && status === "available" && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {state.releaseNotes}
        </p>
      )}
      {blocked && <p style={{ margin: 0, color: "var(--warn)" }}>{blocked}</p>}
      <div className="row">
        <button onClick={() => window.api.updates.check()} disabled={status === "disabled" || status === "checking" || status === "downloading"}>
          Check now
        </button>
        {status === "available" && (
          <button className="primary" onClick={() => window.api.updates.download()}>
            Download update
          </button>
        )}
        {status === "ready" && (
          <button className="primary" onClick={install}>
            Install and restart
          </button>
        )}
      </div>
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={settings?.updateCheckEnabled !== false} onChange={(e) => toggleAuto(e.target.checked)} />
        <span style={{ color: "var(--text)" }}>Check for updates automatically (it never installs by itself)</span>
      </label>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        An update is only installed when you click, and never while messages are being sent.
      </p>
    </div>
  );
}
