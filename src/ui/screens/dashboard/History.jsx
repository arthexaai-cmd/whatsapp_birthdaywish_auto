import React, { useEffect, useState } from "react";

export default function History() {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sends, setSends] = useState([]);

  useEffect(() => {
    window.api.history.listRuns(50).then(setRuns);
  }, []);

  const openRun = async (run) => {
    setSelected(run);
    setSends(await window.api.history.getRunSends(run.id));
  };

  return (
    <div className="stack">
      <h1>History</h1>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Failed</th>
              <th>Not on WhatsApp</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const summary = r.summary_json ? JSON.parse(r.summary_json) : {};
              return (
                <tr key={r.id}>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td className="muted">{r.status}</td>
                  <td>{summary.sent ?? "—"}</td>
                  <td>{summary.failed ?? "—"}</td>
                  <td>{summary.notOnWhatsapp ?? "—"}</td>
                  <td>
                    <button onClick={() => openRun(r)}>Details</button>
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Run at {new Date(selected.started_at).toLocaleString()}</h3>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Belated</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="muted">{s.phone}</td>
                  <td>{s.status}</td>
                  <td className="muted">{s.belated ? "Yes" : ""}</td>
                  <td className="muted">{s.error || ""}</td>
                </tr>
              ))}
              {sends.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No recipients this run.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
