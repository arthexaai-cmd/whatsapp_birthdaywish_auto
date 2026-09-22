import React, { useEffect, useState, useCallback } from "react";
import Wizard from "./screens/Wizard.jsx";
import Dashboard from "./screens/Dashboard.jsx";

// Wizard is considered "done" once the risk consent was accepted and
// WhatsApp is paired (or was at some point -- a later disconnect is handled
// by the Settings screen's reconnect flow, not by dropping back into the
// wizard). Contacts are intentionally NOT required here: the wizard offers
// a "skip for now" import option, and an empty contact list is still a
// valid state -- the Contacts tab covers adding people afterwards.
function isSetupComplete(settings, waState) {
  if (!settings?.riskAcknowledged) return false;
  if (waState?.status !== "ready" && !settings.hasEverPaired) return false;
  return true;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [waState, setWaState] = useState({ status: "disconnected" });
  const [contactCount, setContactCount] = useState(0);
  const [forceWizard, setForceWizard] = useState(false);

  const refresh = useCallback(async () => {
    const [s, w, contacts] = await Promise.all([
      window.api.settings.getAll(),
      window.api.whatsapp.getState(),
      window.api.contacts.list(),
    ]);
    setSettings(s);
    setWaState(w);
    setContactCount(contacts.length);
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

  const setupComplete = !forceWizard && isSetupComplete(settings, waState);

  if (!setupComplete) {
    return (
      <Wizard
        settings={settings}
        waState={waState}
        onComplete={async () => {
          setForceWizard(false);
          await refresh();
        }}
        onSettingsChange={refresh}
      />
    );
  }

  return <Dashboard settings={settings} waState={waState} onSettingsChange={refresh} onReopenWizard={() => setForceWizard(true)} />;
}
