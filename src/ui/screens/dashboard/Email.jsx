import React, { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "../../errors.js";
import CardThumb from "../../components/CardThumb.jsx";
import { EMAIL_PRESETS, MAX_ACCOUNTS, DEFAULT_ACCOUNT_CAP, MAX_ACCOUNT_CAP } from "../../../core/emailAccounts.js";

const hint = { fontSize: 12, margin: 0 };
const PRESET_ORDER = ["gmail", "outlook", "other"];
const EMPTY_FORM = { id: null, preset: "gmail", user: "", fromName: "", dailyCap: String(DEFAULT_ACCOUNT_CAP), host: "", port: "587", secure: false, fromEmail: "", password: "", enabled: true };

function AccountForm({ initial, onSave, onCancel, busy }) {
  const [f, setF] = useState(initial);
  const set = (p) => setF((cur) => ({ ...cur, ...p }));
  const isNew = !initial.id;
  const other = f.preset === "other";

  return (
    <div className="card stack" style={{ background: "var(--bg)" }}>
      <h3>{isNew ? "Add a sender account" : "Edit sender account"}</h3>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {PRESET_ORDER.map((p) => (
          <button key={p} className={f.preset === p ? "primary" : ""} onClick={() => set({ preset: p })} disabled={!isNew && f.preset !== p}>
            {EMAIL_PRESETS[p].label}
          </button>
        ))}
      </div>

      <div>
        <label>{other ? "Username or email address you sign in with" : "Your email address"}</label>
        <input type="text" value={f.user} onChange={(e) => set({ user: e.target.value })} style={{ width: "100%" }} placeholder="name@example.com" />
      </div>
      <div>
        <label>{isNew ? "App password" : "App password (leave blank to keep the saved one)"}</label>
        <input type="password" autoComplete="off" value={f.password} onChange={(e) => set({ password: e.target.value })} style={{ width: "100%" }} />
        {f.preset === "gmail" && (
          <p className="muted" style={{ ...hint, marginTop: 6 }}>
            Gmail needs an <strong>app password</strong>, not your normal password: (1) turn on 2-Step Verification in your Google account, (2) open{" "}
            <code>myaccount.google.com/apppasswords</code> in your browser, (3) create one called "Birthday Bot" and paste the 16-letter code here. If you change your Google password later, make a new one.
          </p>
        )}
        {f.preset === "outlook" && (
          <p className="muted" style={{ ...hint, marginTop: 6 }}>
            <strong>Personal outlook.com / hotmail account:</strong> turn on two-step verification at <code>account.live.com</code>, then create an{" "}
            <strong>app password</strong> there and paste it here instead of your normal password.
            <br />
            <strong>Work or school (Microsoft 365) account:</strong> many organizations turn this kind of sign-in off entirely for security, and you likely
            can't re-enable it yourself — ask your IT admin, or use a personal Gmail or Outlook.com account instead.
            <br />
            Either way, use <strong>Test connection</strong> after saving to confirm it works.
          </p>
        )}
      </div>

      {other && (
        <>
          <div className="row">
            <div style={{ flex: 1 }}>
              <label>Mail server</label>
              <input type="text" value={f.host} onChange={(e) => set({ host: e.target.value })} style={{ width: "100%" }} placeholder="smtp.example.com" />
            </div>
            <div>
              <label>Port</label>
              <input type="number" value={f.port} onChange={(e) => set({ port: e.target.value })} style={{ width: 90 }} />
            </div>
          </div>
          <label className="row" style={{ cursor: "pointer", color: "var(--text)", fontSize: 14 }}>
            <input type="checkbox" checked={f.secure} onChange={(e) => set({ secure: e.target.checked })} />
            Use SSL (usually on for port 465, off for 587)
          </label>
          <div>
            <label>Address to send from (only if your username isn't an email address)</label>
            <input type="text" value={f.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} style={{ width: "100%" }} />
          </div>
        </>
      )}

      <div className="row">
        <div style={{ flex: 1 }}>
          <label>Sender name shown to people (optional)</label>
          <input type="text" value={f.fromName} onChange={(e) => set({ fromName: e.target.value })} style={{ width: "100%" }} placeholder="Arthexa" />
        </div>
        <div>
          <label>Daily limit</label>
          <input type="number" min="1" max={MAX_ACCOUNT_CAP} value={f.dailyCap} onChange={(e) => set({ dailyCap: e.target.value })} style={{ width: 90 }} />
        </div>
      </div>
      <p className="muted" style={hint}>
        Gmail may stop an account that sends too many emails in a day (around 100 over this kind of connection is a safe amount). The daily limit makes the app stop before that happens.
      </p>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => onSave(f)}>
          Save account
        </button>
        <button disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function describeEvent(e) {
  const who = (x) => x?.name ?? "";
  const from = e.account?.label ? ` from ${e.account.label}` : "";
  switch (e.phase) {
    case "matched":
      return `${e.personCount} ${e.personCount === 1 ? "person" : "people"}, ${e.emailCount} email${e.emailCount === 1 ? "" : "s"} to send.`;
    case "sending":
      return `Sending to ${who(e.person)}${from}…`;
    case "sent":
      return `✓ Sent to ${who(e.person)}${from}`;
    case "send_failed":
      return `✗ Failed for ${who(e.person)}${from}: ${e.error}`;
    case "card_fallback":
      return `! Couldn't make the card for ${who(e.person)} (${e.error}); sending the email without the picture.`;
    case "account_stopped":
      return `■ Stopped sending from ${e.account.label}: ${e.message}`;
    case "all_accounts_stopped":
      return "Every sender account has stopped, so the run ended.";
    case "complete":
      return "Done.";
    case "cancelled":
      return "Cancelled.";
    default:
      return e.phase;
  }
}

export default function Email({ settings, onSettingsChange, onOpenCards }) {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null); // Set of ids chosen to send from; null until accounts load
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [subject, setSubject] = useState(settings?.emailSubject ?? "Happy Birthday {name}!");
  const [status, setStatus] = useState({}); // per account: message from Test / test email
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const logRef = useRef(null);

  const ready = accounts.filter((a) => a.enabled && a.hasPassword);
  const chosen = ready.filter((a) => selected?.has(a.id));

  const loadAccounts = useCallback(async () => {
    const list = await window.api.email.listAccounts();
    setAccounts(list);
    setSelected((cur) => {
      const readyIds = list.filter((a) => a.enabled && a.hasPassword).map((a) => a.id);
      if (cur === null) return new Set(readyIds); // first load: all ready accounts
      return new Set(readyIds.filter((id) => cur.has(id)));
    });
  }, []);

  useEffect(() => {
    loadAccounts().catch((err) => setError(friendlyError(err)));
    return window.api.email.onProgress((e) => setEvents((cur) => [...cur, e]));
  }, [loadAccounts]);

  const loadPreview = useCallback(async () => {
    if (selected === null) return;
    try {
      setPreview(await window.api.email.previewToday([...selected]));
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [selected]);
  useEffect(() => {
    loadPreview();
  }, [loadPreview, accounts]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  const guard = async (fn) => {
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

  const saveAccount = (f) =>
    guard(async () => {
      const account = {
        id: f.id ?? undefined,
        preset: f.preset,
        user: f.user.trim(),
        fromName: f.fromName.trim(),
        dailyCap: f.dailyCap === "" ? undefined : Number(f.dailyCap),
        enabled: f.enabled,
        ...(f.preset === "other" ? { host: f.host.trim(), port: Number(f.port), secure: !!f.secure, fromEmail: f.fromEmail.trim() } : {}),
      };
      const list = await window.api.email.saveAccount(account, f.password);
      setAccounts(list);
      setForm(null);
      await loadAccounts();
    });

  const removeAccount = (a) => {
    if (!window.confirm(`Remove ${a.label}? Its saved password is deleted too.`)) return;
    guard(async () => {
      await window.api.email.deleteAccount(a.id);
      await loadAccounts();
    });
  };

  const test = (a) =>
    guard(async () => {
      setStatus((s) => ({ ...s, [a.id]: "Testing…" }));
      try {
        await window.api.email.testAccount(a.id);
        setStatus((s) => ({ ...s, [a.id]: "✓ Connected. The address and password work." }));
      } catch (err) {
        setStatus((s) => ({ ...s, [a.id]: `✗ ${friendlyError(err)}` }));
      }
    });

  const sendTest = (a) =>
    guard(async () => {
      setStatus((s) => ({ ...s, [a.id]: "Sending a test email…" }));
      try {
        const r = await window.api.email.sendTest(a.id);
        setStatus((s) => ({ ...s, [a.id]: `✓ Test email sent to ${r.to}${r.withCard ? "" : " (no birthday picture is set up yet, so it has no card)"}. Check that inbox.` }));
      } catch (err) {
        setStatus((s) => ({ ...s, [a.id]: `✗ ${friendlyError(err)}` }));
      }
    });

  const saveSubject = () =>
    guard(async () => {
      await window.api.settings.set("emailSubject", subject);
      onSettingsChange?.();
    });

  const toggle = (id) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const people = preview?.people ?? [];
  const startRun = async () => {
    const n = preview.totalEmails;
    const ok = window.confirm(
      `Send ${n} birthday email${n === 1 ? "" : "s"} (${people.length} ${people.length === 1 ? "person" : "people"} from ${chosen.length} account${chosen.length === 1 ? "" : "s"})?\n\n` +
        "Each person gets one email from every account you ticked. Keep the app open until it finishes."
    );
    if (!ok) return;
    const approved = Object.fromEntries(people.map((p) => [p.contactId, p.text]));
    setError(null);
    setEvents([]);
    setRunning(true);
    try {
      await window.api.email.run([...selected], approved);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setRunning(false);
      loadPreview();
    }
  };

  const labelFor = (id) => accounts.find((a) => a.id === id)?.label ?? id;
  const overCapAccounts = (preview?.accounts ?? []).filter((a) => a.overCap > 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>Birthday emails</h2>
      {error && (
        <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="card stack">
        <h3>1. Sender accounts</h3>
        <p className="muted" style={hint}>
          Emails are sent from your own email accounts. Each person gets one email from <strong>every</strong> account you tick when you send. A separate account just for birthdays is safest, because
          your email provider can pause an account that sends too much.
        </p>
        {accounts.map((a) => (
          <div key={a.id} className="stack" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <strong>{a.label}</strong>{" "}
                <span className="muted" style={{ fontSize: 12 }}>
                  {EMAIL_PRESETS[a.preset].label} · limit {a.dailyCap}/day
                </span>{" "}
                {a.hasPassword ? <span className="badge ok">ready</span> : <span className="badge warn">needs password</span>}
              </div>
              <div className="row">
                <button disabled={busy || !a.hasPassword} onClick={() => test(a)}>
                  Test connection
                </button>
                <button disabled={busy || !a.hasPassword} onClick={() => sendTest(a)}>
                  Send a test email to myself
                </button>
                <button
                  disabled={busy}
                  onClick={() => setForm({ ...EMPTY_FORM, ...a, dailyCap: String(a.dailyCap), port: String(a.port), password: "", fromEmail: a.fromEmail === a.user ? "" : a.fromEmail })}
                >
                  Edit
                </button>
                <button className="danger" disabled={busy} onClick={() => removeAccount(a)}>
                  Remove
                </button>
              </div>
            </div>
            {status[a.id] && <p style={{ ...hint, color: status[a.id].startsWith("✗") ? "var(--danger)" : "var(--text)" }}>{status[a.id]}</p>}
          </div>
        ))}
        {accounts.length === 0 && !form && <p className="muted" style={hint}>No sender account yet.</p>}
        {form ? (
          <AccountForm initial={form} busy={busy} onSave={saveAccount} onCancel={() => setForm(null)} />
        ) : (
          <div className="row">
            <button className="primary" disabled={busy || accounts.length >= MAX_ACCOUNTS} onClick={() => setForm({ ...EMPTY_FORM })}>
              Add a sender account
            </button>
            {accounts.length >= MAX_ACCOUNTS && <span className="muted" style={hint}>You can add up to {MAX_ACCOUNTS}.</span>}
          </div>
        )}
        <div>
          <label>Email subject ({"{name}"} becomes the person's name)</label>
          <div className="row">
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ flex: 1 }} />
            <button disabled={busy || subject === settings?.emailSubject} onClick={saveSubject}>
              Save subject
            </button>
          </div>
        </div>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <h3>2. Today's emails</h3>
            <p className="muted" style={{ ...hint, marginTop: 4 }}>
              People with a birthday today (or just missed) who have an email address saved.
            </p>
          </div>
          <div className="row">
            <button disabled={running || busy} onClick={loadPreview}>
              Refresh
            </button>
            {running ? (
              <button className="danger" onClick={() => window.api.email.cancel()}>
                Cancel
              </button>
            ) : (
              <button className="primary" disabled={busy || !preview || preview.totalEmails === 0 || chosen.length === 0} onClick={startRun}>
                Send emails {preview?.totalEmails ? `(${preview.totalEmails})` : ""}
              </button>
            )}
          </div>
        </div>

        {ready.length === 0 ? (
          <p className="muted" style={hint}>Add a sender account above (with its password) to send emails.</p>
        ) : (
          <div>
            <label>Send from</label>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {ready.map((a) => (
                <label key={a.id} className="row" style={{ cursor: "pointer", color: "var(--text)", fontSize: 14, marginBottom: 0 }}>
                  <input type="checkbox" checked={selected?.has(a.id) ?? false} disabled={running} onChange={() => toggle(a.id)} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {preview && people.length > 0 && chosen.length > 0 && (
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>
              {people.length} {people.length === 1 ? "person" : "people"} × {chosen.length} account{chosen.length === 1 ? "" : "s"} = {preview.totalEmails} email{preview.totalEmails === 1 ? "" : "s"}
            </strong>
            <span className="muted"> — each person gets one email from each ticked account.</span>
          </p>
        )}
        {overCapAccounts.map((a) => (
          <p key={a.id} style={{ ...hint, color: "var(--warn)" }}>
            {a.label} can only send {a.capacityLeft} more right now, but has {a.pending} to send. It will stop at its limit; the rest wait for the next send.
          </p>
        ))}
        {preview && !preview.hasCard && people.length > 0 && (
          <p style={{ ...hint, color: "var(--warn)" }}>
            No birthday picture is set up, so these emails will have text only.{" "}
            {onOpenCards && (
              <button onClick={onOpenCards} style={{ padding: "2px 8px" }}>
                Set up the card
              </button>
            )}
          </p>
        )}

        {preview && people.length === 0 && chosen.length > 0 && <p className="muted" style={{ margin: 0 }}>No emails to send right now. 🎉</p>}
        {people.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Sends from</th>
                {preview.hasCard && <th>Card</th>}
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.contactId}>
                  <td>
                    {p.name}
                    {p.belated && (
                      <span className="badge warn" style={{ marginLeft: 6 }} title={`Birthday was ${p.occurrence}`}>
                        belated
                      </span>
                    )}
                  </td>
                  <td className="muted">{p.email}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {p.pendingSenders.map(labelFor).join(", ")}
                  </td>
                  {preview.hasCard && (
                    <td>
                      <CardThumb contactId={p.contactId} />
                    </td>
                  )}
                  <td style={{ whiteSpace: "pre-wrap" }}>{p.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview?.noEmail?.length > 0 && (
          <p className="muted" style={hint}>
            No email address saved for: {preview.noEmail.map((n) => n.name).join(", ")}. Add one in the Contacts tab.
          </p>
        )}

        {events.length > 0 && (
          <div ref={logRef} style={{ maxHeight: 220, overflow: "auto", fontSize: 12, fontFamily: "ui-monospace, monospace", background: "var(--bg)", borderRadius: 8, padding: 10 }}>
            {events.map((e, i) => (
              <div key={i}>{describeEvent(e)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
