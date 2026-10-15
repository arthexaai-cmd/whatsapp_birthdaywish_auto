import React, { useEffect, useState } from "react";

// Small birthday card for one contact in a review list. Rendered in the main
// process by the same code that draws the card at send time, so the review
// shows what will actually be sent.
export default function CardThumb({ contactId }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let stale = false;
    window.api.cards
      .renderForContact(contactId)
      .then((url) => !stale && setSrc(url))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [contactId]);
  if (!src) return <div style={{ width: 90, height: 90, borderRadius: 6, background: "var(--border)" }} />;
  return <img src={src} alt="Birthday card" style={{ width: 90, height: 90, objectFit: "contain", borderRadius: 6, display: "block" }} />;
}
