import React, { useState } from "react";

export default function ConsentStep({ onAccept, onCancel }) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="stack">
      <h1>Before you connect WhatsApp</h1>
      <p className="muted">
        Birthday Bot can send birthday messages through your own WhatsApp account, using WhatsApp Web automation
        (not WhatsApp's official Business API). WhatsApp is optional: email works without it.
      </p>
      <div className="consent-box">
        <strong>Please read before continuing:</strong>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          <li>This kind of automation is against WhatsApp's Terms of Service.</li>
          <li>WhatsApp can restrict or permanently ban the number you pair, at their discretion.</li>
          <li>Use a number you can afford to lose access to — not your only or primary number.</li>
          <li>
            This app ships with conservative defaults (slow pacing, daily limits, quiet hours) to reduce — not
            eliminate — that risk. You can review and adjust them in Schedule settings.
          </li>
          <li>Always test with a Dry Run and your own number before sending to your real contact list.</li>
        </ul>
      </div>
      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span style={{ color: "var(--text)" }}>I understand the risk and want to continue.</span>
      </label>
      <div className="row">
        <button className="primary" disabled={!checked} onClick={onAccept}>
          Continue
        </button>
        {onCancel && <button onClick={onCancel}>Not now</button>}
      </div>
    </div>
  );
}
