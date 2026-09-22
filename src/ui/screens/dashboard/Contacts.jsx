import React, { useEffect, useState } from "react";

const EMPTY_FORM = { id: null, name: "", phoneE164: "", birthMonth: "", birthDay: "", birthYear: "", customMessage: "", salutation: "", skip: false };

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importPath, setImportPath] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => setContacts(await window.api.contacts.list());
  useEffect(() => {
    load();
  }, []);

  const filtered = contacts.filter(
    (c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.phoneE164.includes(query)
  );

  const startEdit = (c) =>
    setForm(
      c
        ? { ...c, birthMonth: String(c.birthMonth), birthDay: String(c.birthDay), birthYear: c.birthYear ? String(c.birthYear) : "" }
        : { ...EMPTY_FORM }
    );

  const save = async () => {
    setError(null);
    try {
      await window.api.contacts.upsert({
        id: form.id,
        name: form.name.trim(),
        phoneE164: form.phoneE164.trim(),
        birthMonth: Number(form.birthMonth),
        birthDay: Number(form.birthDay),
        birthYear: form.birthYear ? Number(form.birthYear) : null,
        customMessage: form.customMessage || null,
        salutation: form.salutation || null,
        skip: !!form.skip,
      });
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  const remove = async (id) => {
    await window.api.contacts.delete(id);
    await load();
  };

  const pickImport = async () => {
    const path = await window.api.contacts.pickExcelFile();
    if (!path) return;
    setImportPath(path);
    setImportPreview(await window.api.contacts.previewImport(path));
  };

  const confirmImport = async () => {
    await window.api.contacts.confirmImport(importPath);
    setImportPreview(null);
    setImportPath(null);
    await load();
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Contacts ({contacts.length})</h1>
        <div className="row">
          <button onClick={pickImport}>Import Excel…</button>
          <button className="primary" onClick={() => startEdit(null)}>
            Add contact
          </button>
        </div>
      </div>

      {importPreview && (
        <div className="card stack">
          <h3>Import preview</h3>
          <div className="row">
            <span className="badge ok">{importPreview.added} to add</span>
            <span className="badge warn">{importPreview.updated} to update</span>
            {importPreview.errors.length > 0 && <span className="badge danger">{importPreview.errors.length} errors</span>}
          </div>
          <div className="row">
            <button
              onClick={() => {
                setImportPreview(null);
                setImportPath(null);
              }}
            >
              Cancel
            </button>
            <button className="primary" onClick={confirmImport}>
              Import
            </button>
          </div>
        </div>
      )}

      <input type="text" placeholder="Search by name or phone…" value={query} onChange={(e) => setQuery(e.target.value)} />

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Birthday</th>
              <th>Custom message</th>
              <th>Skip</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.phoneE164}</td>
                <td className="muted">
                  {String(c.birthDay).padStart(2, "0")}/{String(c.birthMonth).padStart(2, "0")}
                  {c.birthYear ? `/${c.birthYear}` : ""}
                </td>
                <td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.customMessage || ""}
                </td>
                <td>{c.skip ? "Yes" : ""}</td>
                <td className="row">
                  <button onClick={() => startEdit(c)}>Edit</button>
                  <button className="danger" onClick={() => remove(c.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No contacts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="card stack">
          <h3>{form.id ? "Edit contact" : "Add contact"}</h3>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <div className="row">
            <div style={{ flex: 1 }}>
              <label>Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Phone (any format)</label>
              <input type="text" value={form.phoneE164} onChange={(e) => setForm({ ...form, phoneE164: e.target.value })} style={{ width: "100%" }} />
            </div>
          </div>
          <div className="row">
            <div>
              <label>Day</label>
              <input type="number" min="1" max="31" value={form.birthDay} onChange={(e) => setForm({ ...form, birthDay: e.target.value })} style={{ width: 70 }} />
            </div>
            <div>
              <label>Month</label>
              <input type="number" min="1" max="12" value={form.birthMonth} onChange={(e) => setForm({ ...form, birthMonth: e.target.value })} style={{ width: 70 }} />
            </div>
            <div>
              <label>Year (optional)</label>
              <input type="number" value={form.birthYear} onChange={(e) => setForm({ ...form, birthYear: e.target.value })} style={{ width: 90 }} />
            </div>
            <div>
              <label>Salutation (optional)</label>
              <input type="text" value={form.salutation} onChange={(e) => setForm({ ...form, salutation: e.target.value })} />
            </div>
          </div>
          <div>
            <label>Custom message (optional — overrides templates, {"{name}"} is replaced)</label>
            <textarea rows={2} style={{ width: "100%" }} value={form.customMessage} onChange={(e) => setForm({ ...form, customMessage: e.target.value })} />
          </div>
          <label className="row" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={form.skip} onChange={(e) => setForm({ ...form, skip: e.target.checked })} />
            <span style={{ color: "var(--text)" }}>Skip this person (never send)</span>
          </label>
          <div className="row">
            <button onClick={() => setForm(null)}>Cancel</button>
            <button className="primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
