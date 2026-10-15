import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "../../errors.js";
import { CARD_FONTS, CARD_COLORS, DEFAULT_CARD_CONFIG, clampBox, normalizeRotationDeg, unrotateDelta } from "../../../core/cardLayout.js";

// Every .woff in assets/fonts, keyed by file name, loaded as a URL Vite can
// serve. Adding a font to CARD_FONTS + assets/fonts/ is then the only step
// needed -- nothing here needs editing per font.
const FONT_FILES = import.meta.glob("../../../../assets/fonts/*.woff", { eager: true, query: "?url", import: "default" });
const fontUrl = (file) => Object.entries(FONT_FILES).find(([p]) => p.endsWith("/" + file))?.[1];
const FONT_FACE_CSS = CARD_FONTS.map((f) => `@font-face{font-family:"${f.css}";src:url("${fontUrl(f.file)}");}`).join("\n");
const FONT_CATEGORIES = [...new Set(CARD_FONTS.map((f) => f.category))];

const FORMATS = [
  { value: "text", label: "Text only", help: "A birthday message, like today." },
  { value: "image", label: "Picture only", help: "A birthday card with the person's name on it, and no text." },
  { value: "both", label: "Picture + text", help: "The birthday card, with the message written under it." },
];

// Names used to check the card: a short one, a typical one, and one that is far too long.
const SAMPLES = [
  { label: "Short name", name: "Al Roy", salutation: "" },
  { label: "Typical name", name: "Priya Sharma", salutation: "Mrs" },
  { label: "Very long name", name: "Venkatasubramanian Raghunathan Iyer", salutation: "" },
];

const hint = { fontSize: 12, margin: 0 };

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// The picture with the dashed name box on top. Drag the box to move it, drag
// a corner to resize it, drag the handle above it to rotate it. Positions are
// fractions of the picture, so they survive any picture size; clampBox keeps
// the box inside, and rotation is purely a display/render rotation around the
// box's own centre -- the stored box stays a simple axis-aligned rectangle.
function BoxEditor({ src, box, rotation, onChange, onRotate }) {
  const wrap = useRef(null);
  const drag = useRef(null);

  const begin = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, box, rotation };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();

    if (d.mode === "rotate") {
      const cx = r.left + (d.box.x + d.box.w / 2) * r.width;
      const cy = r.top + (d.box.y + d.box.h / 2) * r.height;
      // atan2 in actual rendered pixels (not fraction units), so a
      // non-square picture doesn't skew the angle.
      const deg = (Math.atan2(e.clientX - cx, cy - e.clientY) * 180) / Math.PI;
      onRotate(normalizeRotationDeg(deg));
      return;
    }

    const dxRaw = (e.clientX - d.x) / r.width;
    const dyRaw = (e.clientY - d.y) / r.height;
    const b = d.box;
    let { x, y, w, h } = b;
    if (d.mode === "move") {
      x = Math.min(1 - w, Math.max(0, b.x + dxRaw));
      y = Math.min(1 - h, Math.max(0, b.y + dyRaw));
    } else {
      // Resizing a rotated box: express the drag in the box's own (unrotated)
      // axes first, so dragging "outward" always grows it, whichever way it
      // is currently turned.
      const [dx, dy] = unrotateDelta(dxRaw, dyRaw, d.rotation);
      const left = d.mode.includes("w");
      const top = d.mode.includes("n");
      if (left) {
        x = Math.max(0, Math.min(b.x + dx, b.x + b.w - 0.05));
        w = b.x + b.w - x;
      } else {
        w = Math.max(0.05, Math.min(b.w + dx, 1 - b.x));
      }
      if (top) {
        y = Math.max(0, Math.min(b.y + dy, b.y + b.h - 0.05));
        h = b.y + b.h - y;
      } else {
        h = Math.max(0.05, Math.min(b.h + dy, 1 - b.y));
      }
    }
    onChange(clampBox({ x, y, w, h }));
  };
  const end = () => {
    drag.current = null;
  };

  const handle = (mode, style) => (
    <div
      onPointerDown={begin(mode)}
      onPointerMove={move}
      onPointerUp={end}
      style={{ position: "absolute", width: 14, height: 14, background: "var(--accent)", border: "2px solid #fff", borderRadius: 3, touchAction: "none", ...style }}
    />
  );

  return (
    <div ref={wrap} style={{ position: "relative", userSelect: "none", lineHeight: 0, maxWidth: 560, margin: "0 auto" }}>
      <img src={src} alt="Your birthday card" style={{ width: "100%", borderRadius: 8, display: "block" }} draggable={false} />
      <div
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        title="Drag to move"
        style={{
          position: "absolute",
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.w * 100}%`,
          height: `${box.h * 100}%`,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center",
          border: "2px dashed var(--accent)",
          background: "rgba(255,255,255,0.08)",
          cursor: "move",
          touchAction: "none",
          boxSizing: "border-box",
        }}
      >
        {handle("nw", { left: -8, top: -8, cursor: "nwse-resize" })}
        {handle("ne", { right: -8, top: -8, cursor: "nesw-resize" })}
        {handle("sw", { left: -8, bottom: -8, cursor: "nesw-resize" })}
        {handle("se", { right: -8, bottom: -8, cursor: "nwse-resize" })}
        <div style={{ position: "absolute", left: "50%", top: -28, width: 1, height: 28, background: "var(--accent)" }} />
        <div
          onPointerDown={begin("rotate")}
          onPointerMove={move}
          onPointerUp={end}
          title="Drag to rotate"
          style={{
            position: "absolute",
            left: "50%",
            top: -40,
            width: 16,
            height: 16,
            marginLeft: -8,
            background: "var(--accent)",
            border: "2px solid #fff",
            borderRadius: "50%",
            cursor: "grab",
            touchAction: "none",
          }}
        />
      </div>
    </div>
  );
}

function Choice({ checked, onChange, disabled, title, help }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontSize: 14, color: "var(--text)", marginBottom: 0 }}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} style={{ marginTop: 3 }} />
      <span>
        <strong>{title}</strong>
        <br />
        <span className="muted" style={{ fontSize: 12 }}>
          {help}
        </span>
      </span>
    </label>
  );
}

function FontPicker({ value, onChange }) {
  const groups = useMemo(() => FONT_CATEGORIES.map((cat) => [cat, CARD_FONTS.filter((f) => f.category === cat)]), []);
  return (
    <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
      {groups.map(([cat, fonts]) => (
        <div key={cat} style={{ marginBottom: 10 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0" }}>
            {cat}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {fonts.map((f) => (
              <button
                key={f.id}
                className={value === f.id ? "primary" : ""}
                onClick={() => onChange(f.id)}
                style={{ fontFamily: `"${f.css}", sans-serif`, fontSize: 17, padding: "8px 10px", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                Priya
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {CARD_COLORS.map((c) => (
          <button
            key={c.hex}
            title={c.label}
            aria-label={c.label}
            onClick={() => onChange(c.hex)}
            style={{
              width: 32,
              height: 32,
              padding: 0,
              borderRadius: "50%",
              background: c.hex,
              border: value === c.hex ? "3px solid var(--accent)" : "2px solid var(--border)",
            }}
          />
        ))}
      </div>
      <div className="row" style={{ alignItems: "center" }}>
        <label htmlFor="card-color-picker" className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Or any colour:
        </label>
        <input
          id="card-color-picker"
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 44, height: 32, padding: 0, border: "2px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer" }}
        />
        <span className="muted" style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          {value}
        </span>
      </div>
    </div>
  );
}

export default function Cards({ settings, onSettingsChange }) {
  const [saved, setSaved] = useState(null); // config as last saved
  const [config, setConfig] = useState(null); // config being edited
  const [sampleIdx, setSampleIdx] = useState(1);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const format = settings?.messageFormat ?? "text";

  useEffect(() => {
    window.api.cards.getConfig().then((c) => {
      setSaved(c);
      setConfig(c);
    }).catch((err) => setError(friendlyError(err)));
  }, []);

  const debounced = useDebounced(config, 120);
  useEffect(() => {
    if (!debounced?.image) {
      setPreview(null);
      return;
    }
    let stale = false;
    window.api.cards
      .renderPreview(debounced, SAMPLES[sampleIdx])
      .then((url) => !stale && setPreview(url))
      .catch((err) => !stale && setError(friendlyError(err)));
    return () => {
      stale = true;
    };
  }, [debounced, sampleIdx]);

  const dirty = saved && config && JSON.stringify(saved) !== JSON.stringify(config);
  const patch = (p) => {
    setJustSaved(false);
    setConfig((c) => ({ ...c, ...p }));
  };

  const run = async (fn) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const adoptPicture = (c) => {
    if (!c) return; // dialog cancelled
    // A new picture keeps the user's style choices but starts from the saved config.
    setSaved(c);
    setConfig((cur) => ({ ...cur, image: c.image }));
    setJustSaved(false);
    onSettingsChange?.();
  };

  const choosePicture = () => run(async () => adoptPicture(await window.api.cards.pickImage()));
  const useSample = () => run(async () => adoptPicture(await window.api.cards.useSample()));

  const save = () =>
    run(async () => {
      const c = await window.api.cards.saveConfig(config);
      setSaved(c);
      setConfig(c);
      setJustSaved(true);
      onSettingsChange?.();
    });

  const reset = async () => {
    if (!window.confirm("Put the name box and style back to how they started?")) return;
    const fresh = await window.api.cards.getConfig();
    setConfig({ ...DEFAULT_CARD_CONFIG, image: fresh.image });
    setJustSaved(false);
  };

  const setFormat = (value) =>
    run(async () => {
      await window.api.settings.set("messageFormat", value);
      onSettingsChange?.();
    });

  if (!config) return <div className="card">{error ? <p style={{ color: "var(--danger)" }}>{error}</p> : <p className="muted">Loading…</p>}</div>;

  const hasPicture = Boolean(saved?.image);
  const needsPicture = format !== "text" && !hasPicture;
  const rotation = config.rotation ?? 0;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <style>{FONT_FACE_CSS}</style>
      <h2 style={{ margin: 0 }}>Birthday cards</h2>

      {error && (
        <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="card stack">
        <h3>What should each birthday message contain?</h3>
        {FORMATS.map((f) => (
          <Choice
            key={f.value}
            checked={format === f.value}
            disabled={busy || (f.value !== "text" && !hasPicture)}
            onChange={() => setFormat(f.value)}
            title={f.label}
            help={f.help}
          />
        ))}
        {!hasPicture && (
          <p className="muted" style={hint}>
            To send a picture, add your birthday picture below first.
          </p>
        )}
        {needsPicture && (
          <p style={{ ...hint, color: "var(--warn)" }}>Your birthday picture was removed, so wishes will go out as text until you add one.</p>
        )}
      </div>

      <div className="card stack">
        <h3>1. Your birthday picture</h3>
        {!hasPicture ? (
          <>
            <p className="muted" style={hint}>
              Choose a picture with some empty space where each person's name can go. JPG or PNG.
            </p>
            <div className="row">
              <button className="primary" disabled={busy} onClick={choosePicture} style={{ padding: "12px 20px", fontSize: 15 }}>
                Choose your birthday picture
              </button>
              <button disabled={busy} onClick={useSample}>
                Use the sample picture
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <button disabled={busy} onClick={choosePicture}>
              Change picture
            </button>
            <button disabled={busy} onClick={useSample}>
              Use the sample picture
            </button>
          </div>
        )}
      </div>

      {hasPicture && (
        <>
          <div className="card stack">
            <h3>2. Place the name</h3>
            <p className="muted" style={hint}>
              Drag the dashed box to where the name should appear, and its corners to resize it. Drag the round handle above it to tilt it. The name always
              shrinks to fit inside.
            </p>
            {preview ? (
              <BoxEditor src={preview} box={config.box} rotation={rotation} onChange={(box) => patch({ box })} onRotate={(rot) => patch({ rotation: rot })} />
            ) : (
              <p className="muted">Preparing preview…</p>
            )}
            <div className="row" style={{ justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <label className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Tilt:
              </label>
              <input
                type="range"
                min="-180"
                max="180"
                value={rotation}
                onChange={(e) => patch({ rotation: normalizeRotationDeg(Number(e.target.value)) })}
                style={{ width: 160 }}
              />
              <span className="muted" style={{ fontSize: 12, width: 40, textAlign: "right" }}>
                {Math.round(rotation)}°
              </span>
              <button disabled={rotation === 0} onClick={() => patch({ rotation: 0 })}>
                Straighten
              </button>
            </div>
            <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Try it with:
              </span>
              {SAMPLES.map((s, i) => (
                <button key={s.label} className={i === sampleIdx ? "primary" : ""} onClick={() => setSampleIdx(i)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card stack">
            <h3>3. Style</h3>
            <div>
              <label>Font</label>
              <FontPicker value={config.font} onChange={(font) => patch({ font })} />
            </div>
            <div>
              <label>Colour</label>
              <ColorPicker value={config.color} onChange={(color) => patch({ color })} />
            </div>
            <div>
              <label>Position in the box</label>
              <div className="row">
                {[
                  ["left", "Left"],
                  ["center", "Centre"],
                  ["right", "Right"],
                ].map(([v, l]) => (
                  <button key={v} className={config.align === v ? "primary" : ""} onClick={() => patch({ align: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: "var(--text)" }}>
              <input type="checkbox" checked={config.outline} onChange={(e) => patch({ outline: e.target.checked })} />
              Add an outline (keeps the name easy to read on a busy picture)
            </label>
          </div>

          <div className="card stack">
            <h3>4. What to write</h3>
            <p className="muted" style={hint}>
              The name is written exactly as it is in your contacts list.
            </p>
            <div className="row">
              <button className={config.nameParts === "full" ? "primary" : ""} onClick={() => patch({ nameParts: "full" })}>
                Full name
              </button>
              <button className={config.nameParts === "first" ? "primary" : ""} onClick={() => patch({ nameParts: "first" })}>
                First name only
              </button>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: "var(--text)" }}>
              <input type="checkbox" checked={config.includeSalutation} onChange={(e) => patch({ includeSalutation: e.target.checked })} />
              Include the title before the name (Mr, Dr, …) when a contact has one
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: "var(--text)" }}>
              <input type="checkbox" checked={config.includePostfix} onChange={(e) => patch({ includePostfix: e.target.checked })} />
              Include the respectful ending after the name
              {settings?.namePostfixEnabled !== false && settings?.namePostfix ? ` ("${settings.namePostfix}")` : " (switched off in your name settings)"}
            </label>
          </div>

          <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0" }}>
            <button className="primary" disabled={busy || !dirty} onClick={save} style={{ padding: "10px 22px", fontSize: 15 }}>
              Save card
            </button>
            <button disabled={busy} onClick={reset}>
              Start over
            </button>
            {dirty && <span style={{ ...hint, color: "var(--warn)" }}>You have changes that aren't saved yet.</span>}
            {justSaved && !dirty && <span style={{ ...hint, color: "var(--ok, green)" }}>Saved ✓</span>}
          </div>
        </>
      )}
    </div>
  );
}
