import React, { useEffect, useState } from "react";

// Each template gets its own bordered box with a number label, so one
// multi-line message doesn't visually run into the next one. Editing
// swaps the text for its own textarea + Save/Cancel, in place.
const rowBoxStyle = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
};

function TemplateRow({ index, t, onSave, onToggle, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.text);

  return (
    <div className="stack" style={{ ...rowBoxStyle, gap: 8, opacity: t.enabled ? 1 : 0.5 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 11 }}>
          Template {index + 1}
          {!t.enabled && " — disabled"}
        </span>
      </div>

      {editing ? (
        <>
          <textarea
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                if (!draft.trim()) return;
                onSave(t.id, draft);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              onClick={() => {
                setDraft(t.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
          <div className="row">
            <button
              onClick={() => {
                setDraft(t.text);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button onClick={() => onToggle(t.id, !t.enabled)}>{t.enabled ? "Disable" : "Enable"}</button>
            <button className="danger" onClick={() => onDelete(t.id)}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TemplateList({ title, kind, templates, onAdd, onUpdate, onToggle, onDelete }) {
  const [text, setText] = useState("");
  const items = templates.filter((t) => t.kind === kind);

  return (
    <div className="card stack">
      <h3>{title}</h3>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Use <code>{"{name}"}</code> for the recipient&apos;s name and <code>{"{wish}"}</code> for a random line from
        your variable pool below. Press Shift+Enter (or Enter) for a new line within the message.
      </p>
      {items.map((t, i) => (
        <TemplateRow key={t.id} index={i} t={t} onSave={onUpdate} onToggle={onToggle} onDelete={onDelete} />
      ))}
      <div className="stack" style={{ gap: 6 }}>
        <textarea
          rows={2}
          style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
          placeholder="New template…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="primary"
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            if (!text.trim()) return;
            onAdd(kind, text);
            setText("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// One {wish} line: inline edit (reusing the same textarea pattern as
// templates) and delete. Adding uses the plain input box below the list.
function VarRow({ v, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.value);

  return (
    <div className="row" style={{ ...rowBoxStyle, justifyContent: "space-between" }}>
      {editing ? (
        <>
          <input
            type="text"
            style={{ flex: 1 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <button
            className="primary"
            onClick={() => {
              if (!draft.trim()) return;
              onSave(v.id, draft.trim());
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            onClick={() => {
              setDraft(v.value);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span>{v.value}</span>
          <div className="row">
            <button
              onClick={() => {
                setDraft(v.value);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button className="danger" onClick={() => onDelete(v.id)}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function WishPool({ vars, onAdd, onUpdate, onDelete }) {
  const [text, setText] = useState("");
  const items = vars.filter((v) => v.name === "wish");

  return (
    <div className="card stack">
      <h3>Wish pool</h3>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        A random line from here fills in each <code>{"{wish}"}</code> above.
      </p>
      {items.map((v) => (
        <VarRow key={v.id} v={v} onSave={onUpdate} onDelete={onDelete} />
      ))}
      <div className="row">
        <input
          type="text"
          style={{ flex: 1 }}
          placeholder="New wish line…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="primary"
          onClick={() => {
            if (!text.trim()) return;
            onAdd("wish", text.trim());
            setText("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function Messages({ settings }) {
  const [templates, setTemplates] = useState([]);
  const [vars, setVars] = useState([]);
  const [samples, setSamples] = useState([]);

  const load = async () => {
    setTemplates(await window.api.messages.listTemplates());
    setVars(await window.api.messages.listVars());
    setSamples(await window.api.messages.preview(8));
  };
  // Re-run the live preview whenever settings change (e.g. the name
  // postfix), not only on mount -- otherwise it keeps showing stale text.
  useEffect(() => {
    load();
  }, [settings]);

  const add = async (kind, text) => {
    await window.api.messages.addTemplate(kind, text);
    await load();
  };
  const update = async (id, text) => {
    await window.api.messages.updateTemplate(id, text);
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

  const addVar = async (name, value) => {
    await window.api.messages.addVar(name, value);
    await load();
  };
  const updateVar = async (id, value) => {
    await window.api.messages.updateVar(id, value);
    await load();
  };
  const removeVar = async (id) => {
    await window.api.messages.deleteVar(id);
    await load();
  };

  return (
    <div className="stack">
      <h1>Messages</h1>
      <p className="muted">
        A random template is picked for each send and varied further, so the messages going out today won&apos;t all
        read identically.
      </p>

      <TemplateList
        title="On-time messages"
        kind="onTime"
        templates={templates}
        onAdd={add}
        onUpdate={update}
        onToggle={toggle}
        onDelete={remove}
      />
      <TemplateList
        title="Belated messages"
        kind="belated"
        templates={templates}
        onAdd={add}
        onUpdate={update}
        onToggle={toggle}
        onDelete={remove}
      />

      <WishPool vars={vars} onAdd={addVar} onUpdate={updateVar} onDelete={removeVar} />

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Live preview</h3>
          <button onClick={load}>Reshuffle</button>
        </div>
        {samples.map((s, i) => (
          <div key={i} className="muted" style={{ ...rowBoxStyle, whiteSpace: "pre-wrap" }}>
            {s.belated && (
              <div style={{ marginBottom: 4 }}>
                <span className="badge warn">belated</span>
              </div>
            )}
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );
}
