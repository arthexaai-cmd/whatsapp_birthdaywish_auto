import React, { useEffect, useState, useCallback } from "react";
import Dashboard from "./screens/Dashboard.jsx";

// The app opens straight into the dashboard. WhatsApp and Email are both
// optional and set up from there (the Get started checklist, Home, Settings);
// nothing is required before the user can look around.
export default function App() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [waState, setWaState] = useState({ status: "disconnected" });

  const refresh = useCallback(async () => {
    const [s, w] = await Promise.all([window.api.settings.getAll(), window.api.whatsapp.getState()]);
    setSettings(s);
    setWaState(w);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const offWa = window.api.whatsapp.onState((s) => setWaState(s));
    const offToggle = window.api.tray.onToggleScheduling(async () => {
      const current = await window.api.settings.getAll();
      await window.api.settings.set("schedulingPaused", !current.schedulingPaused);
      await refresh();
    });
    return () => {
      offWa();
      offToggle();
    };
  }, [refresh]);

  if (loading) {
    return (
      <div className="wizard-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return <Dashboard settings={settings} waState={waState} onSettingsChange={refresh} />;
}
