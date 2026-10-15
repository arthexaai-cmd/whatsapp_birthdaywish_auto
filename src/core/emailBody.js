// Builds one birthday email: subject, plain-text and HTML bodies. Pure.
// The card picture is shown inside the body through a cid: reference; the
// engine attaches the JPEG inline under CARD_CID.

export const CARD_CID = "birthday-card@birthdaybot";
export const DEFAULT_SUBJECT = "Happy Birthday {name}!";

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subject with {name} filled in. Line breaks are removed (header injection) and the length capped. */
export function buildSubject(template, name) {
  const t = typeof template === "string" && template.trim() ? template : DEFAULT_SUBJECT;
  const clean = t.replace(/\{name\}/g, String(name ?? "")).replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || DEFAULT_SUBJECT.replace("{name}", "")).trim().slice(0, 200);
}

/**
 * @param {object} p
 * @param {string} p.text      the wish
 * @param {boolean} p.hasCard  whether the card is attached inline (cid)
 * @returns {{text: string, html: string}}
 */
export function buildBody({ text, hasCard }) {
  const wish = String(text ?? "");
  const paragraphs = escapeHtml(wish).replace(/\r?\n/g, "<br>");
  const image = hasCard
    ? `<p style="margin:0 0 16px"><img src="cid:${CARD_CID}" alt="Happy Birthday" style="display:block;max-width:100%;height:auto;border-radius:8px"></p>`
    : "";
  const html =
    `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#222;max-width:600px">` +
    image +
    `<p style="margin:0">${paragraphs}</p></div>`;
  return { text: wish, html };
}
