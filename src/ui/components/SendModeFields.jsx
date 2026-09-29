import React from "react";

// Manual vs automatic sending, the daily time, and (manual only) the
// reminder toggle. Shared by the Schedule tab and the setup wizard so the
// two always describe the modes the same way. `values` holds sendMode,
// scheduledTime and reminderEnabled; `set(key, value)` updates one.
export default function SendModeFields({ values, set }) {
  const auto = values.sendMode === "auto";
  const remind = values.reminderEnabled !== false;

  return (
    <div className="stack">
      <label className="row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
        <input type="radio" name="sendMode" checked={!auto} onChange={() => set("sendMode", "manual")} />
        <span style={{ color: "var(--text)" }}>
          <strong>Manual</strong> (recommended) — open the app, check today&apos;s birthdays and press Send.
          <br />
          <span className="muted" style={{ fontSize: 12 }}>
            Nothing is ever sent unless you press Send.
          </span>
        </span>
      </label>
      <label className="row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
        <input type="radio" name="sendMode" checked={auto} onChange={() => set("sendMode", "auto")} />
        <span style={{ color: "var(--text)" }}>
          <strong>Automatic</strong> — send by itself every day at the time below.
          <br />
          <span className="muted" style={{ fontSize: 12 }}>
            The app must be running (it waits in the system tray). It sends for whatever date the computer&apos;s
            clock shows, so keep the clock correct.
          </span>
        </span>
      </label>

      {!auto && (
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={remind} onChange={(e) => set("reminderEnabled", e.target.checked)} />
          <span style={{ color: "var(--text)" }}>Remind me with a notification when there are birthdays to send</span>
        </label>
      )}

      {(auto || remind) && (
        <div>
          <label>{auto ? "Send daily at" : "Remind me daily at"}</label>
          <input type="time" value={values.scheduledTime} onChange={(e) => set("scheduledTime", e.target.value)} />
          {auto && (
            <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
              A random delay of up to ~20 minutes is added so sends don&apos;t look machine-timed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
