// Email address check shared by the roster import, the contact form and the
// sender-account form. Pure and dependency-free so the UI can import it.

// Deliberately simple: one address, no spaces/commas/semicolons/angle brackets
// (so a pasted "a@x.com; b@y.com" or "Name <a@x.com>" is rejected, not half
// understood), and no line breaks (header injection).
const EMAIL_RE = /^[^\s@<>,;"()\\]+@[^\s@<>,;"()\\]+\.[^\s@<>,;"()\\]{2,}$/;

/** @returns {boolean} whether `s` looks like a single usable email address */
export function isValidEmail(s) {
  return typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);
}
