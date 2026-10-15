import React, { useState } from "react";
import ConsentStep from "./whatsapp/ConsentStep.jsx";
import PairStep from "./whatsapp/PairStep.jsx";

// Connecting WhatsApp, on demand: the ban-risk notice first (only until it has
// been accepted once), then the browser check / QR scan. Opened from the Get
// started checklist, the Dashboard and Settings; closing it at any point just
// returns to the dashboard, nothing is forced.
export default function WhatsAppSetup({ settings, waState, onClose, onSettingsChange }) {
  const [accepted, setAccepted] = useState(Boolean(settings?.riskAcknowledged));

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>
        {!accepted ? (
          <ConsentStep
            onCancel={onClose}
            onAccept={async () => {
              await window.api.settings.set("riskAcknowledged", true);
              setAccepted(true);
              await onSettingsChange?.();
            }}
          />
        ) : (
          <>
            <PairStep
              waState={waState}
              onPaired={async () => {
                await onSettingsChange?.();
                onClose();
              }}
            />
            {waState?.status !== "ready" && (
              <div className="row" style={{ marginTop: 16 }}>
                <button onClick={onClose}>Close</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
