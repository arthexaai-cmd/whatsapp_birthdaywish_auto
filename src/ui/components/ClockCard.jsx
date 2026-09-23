import React, { useEffect, useState } from "react";
import { describeDrift } from "../../core/clock.js";

/**
 * Live-ticking clock showing what the app currently believes "now" is (in
 * its configured timezone), plus an on-demand check against true network
 * time. The app has no other source of "now" -- birthday matching, the
 * daily scheduler, and quiet hours all read straight from the system
 * clock, so a wrong clock fails silently otherwise.
 */
export default function ClockCard({ settings }) {
  const [now, setNow] = useState(new Date());
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const tz = settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const osTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const r = await window.api.clock.check();
      setResult(r);
    } finally {
      setChecking(false);
    }
  };

  const openSettings = async () => {
    setOpening(true);
    try {
      const r = await window.api.clock.openDateTimeSettings();
      if (!r.opened) {
        alert(
          "Couldn't open system settings automatically on this platform. Please open your OS's Date & Time settings and enable automatic time sync manually."
        );
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="card stack">
      <h3>System clock</h3>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Birthday matching and the daily schedule are read entirely from this computer's clock — there's no other
        time source. If it's wrong, birthdays can match the wrong day or sends can fire at the wrong time.
      </p>

      <div>
        <div style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>
          {now.toLocaleTimeString("en-GB", { timeZone: tz })}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {now.toLocaleDateString(undefined, { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" })}{" "}
          — app is configured for <strong>{tz}</strong>
        </div>
        {tz !== osTz && (
          <div className="muted" style={{ fontSize: 11, color: "var(--warn)", marginTop: 2 }}>
            Note: your OS reports its timezone as {osTz}, which differs from the app's configured {tz}. Update it on
            the Schedule tab if that's not intentional.
          </div>
        )}
      </div>

      <div className="row">
        <button onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Check clock accuracy"}
        </button>
        {result?.ok === false && (
          <button className="primary" onClick={openSettings} disabled={opening}>
            {opening ? "Opening…" : "Open Date & Time settings"}
          </button>
        )}
      </div>

      {result && (
        <div>
          {result.ok === null && (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              Couldn't check — {result.error} (needs an internet connection).
            </p>
          )}
          {result.ok === true && (
            <p style={{ fontSize: 12, margin: 0, color: "var(--accent)" }}>✓ Your clock is accurate.</p>
          )}
          {result.ok === false && (
            <p style={{ fontSize: 12, margin: 0, color: "var(--danger)" }}>
              ⚠ Your clock appears to be off by about {describeDrift(result.driftMs)} (
              {result.driftMs > 0 ? "ahead" : "behind"}). Turn on "Set time automatically" in Windows' Date &amp;
              Time settings, or use its "Sync now" button.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
