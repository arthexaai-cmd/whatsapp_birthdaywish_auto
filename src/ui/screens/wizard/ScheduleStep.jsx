import React, { useState } from "react";
import SendModeFields from "../../components/SendModeFields.jsx";

export default function ScheduleStep({ settings, onSaved }) {
  const [values, setValues] = useState({
    sendMode: settings?.sendMode === "auto" ? "auto" : "manual",
    reminderEnabled: settings?.reminderEnabled !== false,
    scheduledTime: settings?.scheduledTime || "09:15",
  });
  const [timezone, setTimezone] = useState(settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const save = async () => {
    setSaving(true);
    await window.api.settings.set("sendMode", values.sendMode);
    await window.api.settings.set("reminderEnabled", values.reminderEnabled);
    await window.api.settings.set("scheduledTime", values.scheduledTime);
    await window.api.settings.set("timezone", timezone);
    // Only worth starting with Windows if the app has something to do on
    // its own: automatic sends, or manual-mode reminders.
    await window.api.settings.set("runAtLogin", values.sendMode === "auto" || values.reminderEnabled);
    setSaving(false);
    onSaved();
  };

  return (
    <div className="stack">
      <h1>How should messages be sent?</h1>
      <SendModeFields values={values} set={set} />
      <div>
        <label>Timezone</label>
        <input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: "100%" }} />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>You can change this any time from the Schedule tab.</p>
      <button className="primary" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
