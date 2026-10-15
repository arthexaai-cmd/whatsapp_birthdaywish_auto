import React, { useEffect, useState } from "react";
import Home from "./dashboard/Home.jsx";
import Contacts from "./dashboard/Contacts.jsx";
import Messages from "./dashboard/Messages.jsx";
import Cards from "./dashboard/Cards.jsx";
import Email from "./dashboard/Email.jsx";
import Schedule from "./dashboard/Schedule.jsx";
import History from "./dashboard/History.jsx";
import Reports from "./dashboard/Reports.jsx";
import Settings from "./dashboard/Settings.jsx";
import UpdateBanner from "../components/UpdateBanner.jsx";
import WhatsAppSetup from "./WhatsAppSetup.jsx";

const TABS = [
  { key: "home", label: "Dashboard" },
  { key: "contacts", label: "Contacts" },
  { key: "messages", label: "Messages" },
  { key: "cards", label: "Cards" },
  { key: "email", label: "Email" },
  { key: "schedule", label: "Schedule" },
  { key: "history", label: "History" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
];

export default function Dashboard({ settings, waState, onSettingsChange }) {
  const [tab, setTab] = useState("home");
  const [showWaSetup, setShowWaSetup] = useState(false);
  const openWhatsAppSetup = () => setShowWaSetup(true);

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
      </div>
      <div className="main-content">
        <UpdateBanner />
        {tab === "home" && (
          <Home settings={settings} waState={waState} onSetupWhatsApp={openWhatsAppSetup} onNavigate={setTab} onSettingsChange={onSettingsChange} />
        )}
        {tab === "contacts" && <Contacts />}
        {tab === "messages" && <Messages settings={settings} />}
        {tab === "cards" && <Cards settings={settings} onSettingsChange={onSettingsChange} />}
        {tab === "email" && <Email settings={settings} onSettingsChange={onSettingsChange} onOpenCards={() => setTab("cards")} />}
        {tab === "schedule" && <Schedule settings={settings} onSettingsChange={onSettingsChange} />}
        {tab === "history" && <History />}
        {tab === "reports" && <Reports />}
        {tab === "settings" && (
          <Settings settings={settings} waState={waState} onSettingsChange={onSettingsChange} onSetupWhatsApp={openWhatsAppSetup} />
        )}
      </div>
      {showWaSetup && <WhatsAppSetup settings={settings} waState={waState} onSettingsChange={onSettingsChange} onClose={() => setShowWaSetup(false)} />}
    </div>
  );
}
