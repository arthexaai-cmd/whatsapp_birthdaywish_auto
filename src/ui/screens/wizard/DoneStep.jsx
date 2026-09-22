import React from "react";

export default function DoneStep({ onFinish }) {
  return (
    <div className="stack">
      <h1>All set 🎉</h1>
      <p className="muted">
        Birthday Bot is ready. Before your first real send, try a <strong>Dry Run</strong> from the dashboard — it
        shows exactly what would be sent, to whom, and when, without sending anything.
      </p>
      <button className="primary" onClick={onFinish}>
        Go to dashboard
      </button>
    </div>
  );
}
