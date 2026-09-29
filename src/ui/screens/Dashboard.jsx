import React, { useEffect, useState } from "react";
import Home from "./dashboard/Home.jsx";
import Contacts from "./dashboard/Contacts.jsx";
import Messages from "./dashboard/Messages.jsx";
import Schedule from "./dashboard/Schedule.jsx";
import History from "./dashboard/History.jsx";
import Reports from "./dashboard/Reports.jsx";
import Settings from "./dashboard/Settings.jsx";

const TABS = [
  { key: "home", label: "Dashboard" },
  { key: "contacts", label: "Contacts" },
  { key: "messages", label: "Messages" },
  { key: "schedule", label: "Schedule" },
  { key: "history", label: "History" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
];

export default function Dashboard({ settings, waState, onSettingsChange, onReopenWizard }) {
  const [tab, setTab] = useState("home");

  useEffect(() => {
    const offRunNow = window.api.tray.onRunNow(() => setTab("home"));
    return () => offRunNow();
  }, []);

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">🎂 Birthday Bot</div>
        {TABS.map((t) => (
          <div key={t.key} className={`nav-item ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="nav-item" onClick={onReopenWizard} style={{ fontSize: 12 }}>
          Setup wizard
        </div>
      </div>
      <div className="main-content">
        {tab === "home" && <Home settings={settings} waState={waState} onReopenWizard={onReopenWizard} />}
        {tab === "contacts" && <Contacts />}
        {tab === "messages" && <Messages />}
        {tab === "schedule" && <Schedule settings={settings} onSettingsChange={onSettingsChange} />}
        {tab === "history" && <History />}
        {tab === "reports" && <Reports />}
        {tab === "settings" && (
          <Settings settings={settings} waState={waState} onSettingsChange={onSettingsChange} onReopenWizard={onReopenWizard} />
        )}
      </div>
    </div>
  );
}
