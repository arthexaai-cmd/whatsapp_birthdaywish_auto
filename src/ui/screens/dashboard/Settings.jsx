import React, { useEffect, useState } from "react";
import { friendlyError } from "../../errors.js";
import ClockCard from "../../components/ClockCard.jsx";
import ResetCard from "../../components/ResetCard.jsx";

export default function Settings({ settings, waState, onSettingsChange, onReopenWizard }) {
  const [appInfo, setAppInfo] = useState(null);
  const [selfNotifyNumber, setSelfNotifyNumber] = useState(settings?.selfNotifyNumber || "");
  const [selfNotifyEnabled, setSelfNotifyEnabled] = useState(settings?.selfNotifyEnabled ?? true);
  const [defaultCountry, setDefaultCountry] = useState(settings?.defaultCountry || "IN");
  const [unlinking, setUnlinking] = useState(false);
  const [sampleStatus, setSampleStatus] = useState(null);

  useEffect(() => {
    window.api.settings.appInfo().then(setAppInfo);
  }, []);

  const saveNotify = async () => {
    await window.api.settings.set("selfNotifyNumber", selfNotifyNumber);
    await window.api.settings.set("selfNotifyEnabled", selfNotifyEnabled);
    await window.api.settings.set("defaultCountry", defaultCountry);
    onSettingsChange();
  };

  const saveSample = async () => {
    setSampleStatus(null);
    try {
      const saved = await window.api.contacts.saveSampleFile();
      if (saved) setSampleStatus(`Saved to ${saved}`);
    } catch (err) {
      setSampleStatus(`Could not save: ${friendlyError(err)}`);
    }
  };

  const unlink = async () => {
    if (!confirm("Unlink WhatsApp? You'll need to scan a QR code again to reconnect.")) return;
    setUnlinking(true);
    try {
      await window.api.whatsapp.unlink();
    } catch (err) {
      alert(friendlyError(err));
    } finally {
      setUnlinking(false);
      onSettingsChange();
    }
  };

  return (
    <div className="stack">
      <h1>Settings</h1>

      <ClockCard settings={settings} />

      <div className="card stack">
        <h3>WhatsApp</h3>
        <p className="muted">
          Status: <strong>{waState?.status}</strong>
        </p>
        <div className="row">
          {waState?.status !== "ready" ? (
            <button className="primary" onClick={onReopenWizard}>
              Reconnect
            </button>
          ) : (
            <button className="danger" onClick={unlink} disabled={unlinking}>
              {unlinking ? "Unlinking…" : "Unlink WhatsApp"}
            </button>
          )}
        </div>
      </div>

      <div className="card stack">
        <h3>Run summary notifications</h3>
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={selfNotifyEnabled} onChange={(e) => setSelfNotifyEnabled(e.target.checked)} />
          <span style={{ color: "var(--text)" }}>Send myself a WhatsApp summary after each run</span>
        </label>
        <div>
          <label>Your number (E.164, e.g. +919999999999)</label>
          <input type="text" value={selfNotifyNumber} onChange={(e) => setSelfNotifyNumber(e.target.value)} style={{ width: 260 }} />
        </div>
        <div>
          <label>Default country for phone numbers without a country code</label>
          <input type="text" value={defaultCountry} onChange={(e) => setDefaultCountry(e.target.value.toUpperCase())} style={{ width: 80 }} placeholder="IN" />
        </div>
        <button className="primary" onClick={saveNotify} style={{ alignSelf: "flex-start" }}>
          Save
        </button>
      </div>

      <div className="card stack">
        <h3>Contacts template</h3>
        <p className="muted">
          A blank Excel file with the right columns and instructions. Fill it in, then import it from the Contacts tab.
        </p>
        <button onClick={saveSample} style={{ alignSelf: "flex-start" }}>
          Download sample Excel file
        </button>
        {sampleStatus && (
          <p className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
            {sampleStatus}
          </p>
        )}
      </div>

      <div className="card stack">
        <h3>About</h3>
        <p className="muted">Version {appInfo?.version}</p>
        <p className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
          Data folder: {appInfo?.userDataPath}
        </p>
      </div>

      <ResetCard />
    </div>
  );
}
