import React, { useState } from "react";
import { friendlyMessage } from "../errors.js";
import { useUpdateState, describeUpdate } from "../updates.js";

/**
 * Top-of-dashboard notice when a newer version exists. Nothing happens
 * without a click; installing waits until it is safe (no send running, and
 * in Automatic mode not right before the scheduled send) -- the main process
 * decides, and we show its reason.
 */
export default function UpdateBanner() {
  const state = useUpdateState();
  const [blocked, setBlocked] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!state || !["available", "downloading", "ready"].includes(state.status)) return null;

  const download = async () => {
    setBusy(true);
    try {
      await window.api.updates.download();
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setBlocked(null);
    const result = await window.api.updates.install();
    if (!result.ok) setBlocked(result.reason);
  };

  return (
    <div className="card row" style={{ justifyContent: "space-between", borderColor: "var(--accent)", marginBottom: 12 }}>
      <div>
        <strong>{describeUpdate(state)}</strong>
        {state.releaseNotes && (
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            {state.releaseNotes}
          </p>
        )}
        {blocked && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--warn)" }}>{blocked}</p>}
        {state.error && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--danger)" }}>{friendlyMessage({ message: state.error })}</p>}
      </div>
      {state.status === "available" && (
        <button className="primary" onClick={download} disabled={busy}>
          Download update
        </button>
      )}
      {state.status === "downloading" && (
        <div className="progress-bar" style={{ width: 160 }}>
          <div className="fill" style={{ width: `${state.progress}%` }} />
        </div>
      )}
      {state.status === "ready" && (
        <button className="primary" onClick={install}>
          Install and restart
        </button>
      )}
    </div>
  );
}
