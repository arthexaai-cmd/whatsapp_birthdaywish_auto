import React, { useEffect, useState } from "react";

function TemplateList({ title, kind, templates, onAdd, onToggle, onDelete }) {
  const [text, setText] = useState("");
  const items = templates.filter((t) => t.kind === kind);

  return (
    <div className="card stack">
      <h3>{title}</h3>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Use <code>{"{name}"}</code> for the recipient&apos;s name and <code>{"{wish}"}</code> for a random line from
        your variable pool below.
      </p>
      {items.map((t) => (
        <div key={t.id} className="row" style={{ justifyContent: "space-between" }}>
          <span style={{ opacity: t.enabled ? 1 : 0.4 }}>{t.text}</span>
          <div className="row">
            <button onClick={() => onToggle(t.id, !t.enabled)}>{t.enabled ? "Disable" : "Enable"}</button>
            <button className="danger" onClick={() => onDelete(t.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
      <div className="row">
        <input type="text" style={{ flex: 1 }} placeholder="New template…" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          className="primary"
          onClick={() => {
            if (!text.trim()) return;
            onAdd(kind, text.trim());
            setText("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function Messages() {
  const [templates, setTemplates] = useState([]);
  const [samples, setSamples] = useState([]);

  const load = async () => {
    setTemplates(await window.api.messages.listTemplates());
    setSamples(await window.api.messages.preview(8));
  };
  useEffect(() => {
    load();
  }, []);

  const add = async (kind, text) => {
    await window.api.messages.addTemplate(kind, text);
    await load();
  };
  const toggle = async (id, enabled) => {
    await window.api.messages.setTemplateEnabled(id, enabled);
    await load();
  };
  const remove = async (id) => {
    await window.api.messages.deleteTemplate(id);
    await load();
  };

  return (
    <div className="stack">
      <h1>Messages</h1>
      <p className="muted">
        A random template is picked for each send and varied further, so the messages going out today won&apos;t all
        read identically.
      </p>

      <TemplateList title="On-time messages" kind="onTime" templates={templates} onAdd={add} onToggle={toggle} onDelete={remove} />
      <TemplateList title="Belated messages" kind="belated" templates={templates} onAdd={add} onToggle={toggle} onDelete={remove} />

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Live preview</h3>
          <button onClick={load}>Reshuffle</button>
        </div>
        {samples.map((s, i) => (
          <div key={i} className="muted">
            {s.belated ? "[belated] " : ""}
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );
}
