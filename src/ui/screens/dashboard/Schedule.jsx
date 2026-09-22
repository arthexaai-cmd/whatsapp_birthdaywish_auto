import React, { useState } from "react";

function RangeField({ label, hint, value, onChange, unit }) {
  const [lo, hi] = value;
  return (
    <div>
      <label>{label}</label>
      <div className="row">
        <input type="number" min="0" value={lo} onChange={(e) => onChange([Number(e.target.value), hi])} style={{ width: 70 }} />
        <span className="muted">to</span>
        <input type="number" min="0" value={hi} onChange={(e) => onChange([lo, Number(e.target.value)])} style={{ width: 70 }} />
        <span className="muted">{unit}</span>
      </div>
      {hint && (
        <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export default function Schedule({ settings, onSettingsChange }) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);

  const set = (key, value) => setLocal({ ...local, [key]: value });
  const setPacing = (key, value) => setLocal({ ...local, pacing: { ...local.pacing, [key]: value } });

  const save = async () => {
    setSaving(true);
    await window.api.settings.set("scheduledTime", local.scheduledTime);
    await window.api.settings.set("timezone", local.timezone);
    await window.api.settings.set("catchupDays", local.catchupDays);
    await window.api.settings.set("catchUpOnLaunch", local.catchUpOnLaunch);
    await window.api.settings.set("runAtLogin", local.runAtLogin);
    await window.api.settings.set("pacing", local.pacing);
    setSaving(false);
    onSettingsChange();
  };

  if (!local) return null;

  return (
    <div className="stack">
      <h1>Schedule &amp; pacing</h1>

      <div className="card stack">
        <h3>Daily schedule</h3>
        <div className="row">
          <div>
            <label>Time</label>
            <input type="time" value={local.scheduledTime} onChange={(e) => set("scheduledTime", e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Timezone</label>
            <input type="text" value={local.timezone} onChange={(e) => set("timezone", e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={local.schedulingPaused} onChange={(e) => set("schedulingPaused", e.target.checked)} />
          <span style={{ color: "var(--text)" }}>Pause automatic scheduling</span>
        </label>
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={local.catchUpOnLaunch} onChange={(e) => set("catchUpOnLaunch", e.target.checked)} />
          <span style={{ color: "var(--text)" }}>
            Catch up automatically if the computer was off at the scheduled time
          </span>
        </label>
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={local.runAtLogin} onChange={(e) => set("runAtLogin", e.target.checked)} />
          <span style={{ color: "var(--text)" }}>Start automatically when I log in (minimized to tray)</span>
        </label>
        <div>
          <label>Catch-up window (days back to keep retrying a missed birthday)</label>
          <input type="number" min="0" max="14" value={local.catchupDays} onChange={(e) => set("catchupDays", Number(e.target.value))} style={{ width: 70 }} />
        </div>
      </div>

      <div className="card stack">
        <h3>Pacing (anti-ban)</h3>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          These defaults are deliberately conservative. Sending fast, at machine-regular intervals, or in large
          bursts is what gets numbers flagged — raise these only if you understand the risk.
        </p>
        <RangeField label="Start delay after scheduled time" unit="minutes" value={local.pacing.startJitterMinutes} onChange={(v) => setPacing("startJitterMinutes", v)} />
        <RangeField label="Messages per batch" unit="messages" value={local.pacing.batchSize} onChange={(v) => setPacing("batchSize", v)} />
        <RangeField label="Gap between messages in a batch" unit="seconds" value={local.pacing.withinBatchSeconds} onChange={(v) => setPacing("withinBatchSeconds", v)} />
        <RangeField label="Gap between batches" unit="minutes" value={local.pacing.betweenBatchMinutes} onChange={(v) => setPacing("betweenBatchMinutes", v)} />
        <div>
          <label>Daily cap (max messages per run, ceiling {local.dailyCapMax})</label>
          <input
            type="number"
            min="1"
            max={local.dailyCapMax}
            value={local.pacing.dailyCap}
            onChange={(e) => setPacing("dailyCap", Math.min(Number(e.target.value), local.dailyCapMax))}
            style={{ width: 90 }}
          />
        </div>
        <div className="row">
          <div>
            <label>Quiet hours start</label>
            <input type="time" value={local.pacing.quietHours[0]} onChange={(e) => setPacing("quietHours", [e.target.value, local.pacing.quietHours[1]])} />
          </div>
          <div>
            <label>Quiet hours end</label>
            <input type="time" value={local.pacing.quietHours[1]} onChange={(e) => setPacing("quietHours", [local.pacing.quietHours[0], e.target.value])} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: 0 }}>
          No message is ever sent inside the quiet-hours window; a run that runs long picks up remaining people the
          next scheduled run instead of sending late at night.
        </p>
        <div>
          <label>Warm-up (days of history before reaching the full daily cap)</label>
          <input type="number" min="0" value={local.pacing.warmupDays} onChange={(e) => setPacing("warmupDays", Number(e.target.value))} style={{ width: 70 }} />
        </div>
      </div>

      <button className="primary" onClick={save} disabled={saving} style={{ alignSelf: "flex-start" }}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
