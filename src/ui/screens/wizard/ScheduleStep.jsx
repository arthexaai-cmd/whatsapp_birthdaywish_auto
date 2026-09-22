import React, { useState } from "react";

export default function ScheduleStep({ settings, onSaved }) {
  const [time, setTime] = useState(settings?.scheduledTime || "09:15");
  const [timezone, setTimezone] = useState(settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await window.api.settings.set("scheduledTime", time);
    await window.api.settings.set("timezone", timezone);
    await window.api.settings.set("runAtLogin", true);
    setSaving(false);
    onSaved();
  };

  return (
    <div className="stack">
      <h1>When should it run?</h1>
      <p className="muted">
        Once a day, at roughly this time (a random delay of up to ~75 minutes is added automatically so sends
        don&apos;t look machine-timed). The app runs quietly in the system tray so this works even with the window
        closed — just keep your computer on and connected.
      </p>
      <div className="row">
        <div>
          <label>Daily time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label>Timezone</label>
          <input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        If the computer is off or asleep at the scheduled time, the app automatically catches up the next time it's
        opened.
      </p>
      <button className="primary" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
