import React, { useState } from "react";
import { friendlyError } from "../../errors.js";
import ImportErrors from "../../components/ImportErrors.jsx";

export default function ImportStep({ onDone }) {
  const [filePath, setFilePath] = useState(null);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [samplePath, setSamplePath] = useState(null);

  const pickFile = async () => {
    setError(null);
    const path = await window.api.contacts.pickExcelFile();
    if (!path) return;
    setFilePath(path);
    try {
      const p = await window.api.contacts.previewImport(path);
      setPreview(p);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const saveSample = async () => {
    setError(null);
    try {
      const saved = await window.api.contacts.saveSampleFile();
      if (saved) setSamplePath(saved);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    setError(null);
    try {
      await window.api.contacts.confirmImport(filePath);
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="stack">
      <h1>Import your contact list</h1>
      <p className="muted">
        Pick an Excel file with columns: <code>name</code>, <code>phone</code>, <code>birthdate</code>. Optional:{" "}
        <code>custom_message</code>, <code>salutation</code>, <code>skip</code>. You can always add, edit, or
        re-import later from the Contacts tab.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      {!preview && (
        <div className="row">
          <button className="primary" onClick={pickFile}>
            Choose Excel file…
          </button>
          <button onClick={saveSample}>Download sample Excel file</button>
        </div>
      )}
      {samplePath && !preview && (
        <p className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
          Saved to {samplePath}. Fill it in, save it, then choose it above.
        </p>
      )}

      {preview && (
        <div className="stack">
          <div className="row">
            <span className="badge ok">{preview.added} to add</span>
            <span className="badge warn">{preview.updated} to update</span>
            {preview.errors.length > 0 && <span className="badge danger">{preview.errors.length} rows with errors</span>}
          </div>
          <ImportErrors errors={preview.errors} />
          <div className="row">
            <button onClick={pickFile}>Choose a different file</button>
            <button className="primary" onClick={confirmImport} disabled={importing || preview.total === 0}>
              {importing ? "Importing…" : `Import ${preview.total} contacts`}
            </button>
          </div>
        </div>
      )}

      <div>
        <button onClick={onDone}>Skip for now — I&apos;ll add contacts later</button>
      </div>
    </div>
  );
}
