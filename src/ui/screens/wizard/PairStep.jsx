import React, { useEffect, useState } from "react";

export default function PairStep({ waState, onPaired }) {
  const [browserCheck, setBrowserCheck] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    window.api.whatsapp.checkBrowser().then(setBrowserCheck);
    const off = window.api.whatsapp.onDownloadProgress((p) => setDownloadProgress(p));
    return () => off();
  }, []);

  useEffect(() => {
    if (waState?.status === "ready") {
      const t = setTimeout(onPaired, 700);
      return () => clearTimeout(t);
    }
  }, [waState?.status, onPaired]);

  const startConnect = async () => {
    setError(null);
    setConnecting(true);
    try {
      await window.api.whatsapp.connect();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleDownloadChromium = async () => {
    setError(null);
    try {
      await window.api.whatsapp.downloadChromium();
      const check = await window.api.whatsapp.checkBrowser();
      setBrowserCheck(check.found ? check : { found: true, browser: "chromium" });
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  if (waState?.status === "ready") {
    return (
      <div className="stack">
        <h2>WhatsApp connected ✓</h2>
        <p className="muted">Continuing…</p>
      </div>
    );
  }

  if (browserCheck && !browserCheck.found && !downloadProgress) {
    return (
      <div className="stack">
        <h2>No browser found</h2>
        <p className="muted">
          This app needs Microsoft Edge or Google Chrome installed to connect to WhatsApp Web. Neither was found on
          this computer. You can download a private copy of Chromium just for this app instead (~150MB, one time).
        </p>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <button className="primary" onClick={handleDownloadChromium}>
          Download Chromium
        </button>
      </div>
    );
  }

  if (downloadProgress && downloadProgress.totalBytes > 0 && downloadProgress.downloadedBytes < downloadProgress.totalBytes) {
    const pct = Math.round((downloadProgress.downloadedBytes / downloadProgress.totalBytes) * 100);
    return (
      <div className="stack">
        <h2>Downloading Chromium…</h2>
        <div className="progress-bar">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="muted">{pct}%</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Connect WhatsApp</h1>
      <p className="muted">
        Scan the QR code below with WhatsApp on your phone: open WhatsApp → Settings → Linked devices → Link a
        device.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {waState?.status === "qr" && waState.qrDataUrl ? (
        <div className="qr-box">
          <img src={waState.qrDataUrl} alt="WhatsApp QR code" />
          <p className="muted">Waiting for scan…</p>
        </div>
      ) : (
        <button className="primary" onClick={startConnect} disabled={connecting}>
          {connecting ? "Connecting…" : "Show QR code"}
        </button>
      )}
    </div>
  );
}
