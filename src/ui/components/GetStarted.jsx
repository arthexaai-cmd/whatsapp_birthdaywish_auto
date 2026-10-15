import React, { useEffect, useState } from "react";
import { onboardingChecklist } from "../../core/onboarding.js";

// The "Get started" card on the dashboard. Three optional steps, in any order,
// each ticked from the real state. It hides itself once everything is done, or
// when the user presses "Hide this".
export default function GetStarted({ settings, onSettingsChange, onSetupWhatsApp, onNavigate }) {
  const [counts, setCounts] = useState({ contactCount: 0, emailReadyCount: 0 });

  useEffect(() => {
    let stale = false;
    Promise.all([window.api.contacts.list(), window.api.email.listAccounts()])
      .then(([contacts, accounts]) => {
        if (!stale) setCounts({ contactCount: contacts.length, emailReadyCount: accounts.filter((a) => a.enabled && a.hasPassword).length });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [settings]);

  const list = onboardingChecklist({ settings, ...counts });
  if (!list.show) {
    // Hidden by the user but not finished: keep an easy way back.
    if (settings?.onboardingDismissed && !list.allDone) {
      return (
        <div>
          <button
            onClick={async () => {
              await window.api.settings.set("onboardingDismissed", false);
              onSettingsChange?.();
            }}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Show setup checklist
          </button>
        </div>
      );
    }
    return null;
  }

  const action = {
    contacts: () => onNavigate("contacts"),
    whatsapp: onSetupWhatsApp,
    email: () => onNavigate("email"),
  };
  const blurb = {
    contacts: "Import an Excel file or add people one by one.",
    whatsapp: "Send birthday messages and cards on WhatsApp. Needs a phone to scan a QR code.",
    email: "Send birthday emails with the card. Needs an email account and an app password.",
  };

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Get started</h3>
        <button
          onClick={async () => {
            await window.api.settings.set("onboardingDismissed", true);
            onSettingsChange?.();
          }}
        >
          Hide this
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Do these in any order, and skip what you don't need. You can use WhatsApp, Email, or both.
      </p>
      {list.items.map((item) => (
        <div key={item.key} className="row" style={{ justifyContent: "space-between", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
          <div>
            <strong>
              {item.done ? "✓ " : ""}
              {item.label}
            </strong>
            {item.optional && (
              <span className="muted" style={{ fontSize: 12 }}>
                {" "}
                (optional)
              </span>
            )}
            <div className="muted" style={{ fontSize: 12 }}>
              {blurb[item.key]}
            </div>
          </div>
          <button className={item.done ? "" : "primary"} onClick={action[item.key]}>
            {item.done ? "Manage" : "Set up"}
          </button>
        </div>
      ))}
    </div>
  );
}
