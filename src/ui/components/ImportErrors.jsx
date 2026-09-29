import React from "react";

// Lists the rows an Excel import preview rejected, with a plain-language fix
// for each. The raw reasons come from src/core/roster.js's normalizeRow().

const MAX_SHOWN = 30;

function explain(reason) {
  if (reason === "missing name") return "Name is empty.";
  if (reason === "missing phone") return "Phone number is empty.";
  if (reason === "missing birthdate") return "Birthdate is empty.";
  let m = reason.match(/^invalid phone "(.*)"$/);
  if (m) return `"${m[1]}" isn't a valid phone number. Include the country code, e.g. +919812345678.`;
  m = reason.match(/^invalid birthdate "(.*)"$/);
  if (m) return `Can't read the birthdate "${m[1]}". Use DD/MM/YYYY, DD/MM, or YYYY-MM-DD.`;
  return reason;
}

export default function ImportErrors({ errors }) {
  if (!errors?.length) return null;
  return (
    <div className="card stack" style={{ maxHeight: 200, overflowY: "auto", gap: 4 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        These rows will be skipped. Fix them in Excel, save, and choose the file again, or import the rest now.
      </div>
      {errors.slice(0, MAX_SHOWN).map((e, i) => (
        <div key={i} style={{ fontSize: 12 }}>
          <strong>Row {e.rowNum}</strong>
          {e.name ? ` (${e.name})` : ""}: <span className="muted">{explain(e.reason)}</span>
        </div>
      ))}
      {errors.length > MAX_SHOWN && (
        <div className="muted" style={{ fontSize: 12 }}>
          …and {errors.length - MAX_SHOWN} more
        </div>
      )}
    </div>
  );
}
