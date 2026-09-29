import React from "react";

export default function DoneStep({ onFinish }) {
  return (
    <div className="stack">
      <h1>All set 🎉</h1>
      <p className="muted">
        Birthday Bot is ready. The dashboard lists today&apos;s birthdays with the exact message each person will
        get — press <strong>Send all</strong> when you&apos;re happy with them. <strong>Dry run</strong> shows the
        same plus send times, without sending anything.
      </p>
      <button className="primary" onClick={onFinish}>
        Go to dashboard
      </button>
    </div>
  );
}
