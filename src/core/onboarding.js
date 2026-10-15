// First-run and "is WhatsApp set up?" rules. Pure, so the same decisions drive
// the screens, the scheduler and the send guard, and are unit-tested.
//
// The app opens straight into the dashboard: WhatsApp and Email are both
// optional, set up whenever the user chooses. The one hard rule is that a real
// WhatsApp send needs the user to have accepted the ban-risk notice AND paired
// at least once (the notice is shown inside the WhatsApp setup panel).

/** Whether a real (non-dry-run) WhatsApp send is allowed at all. */
export function canSendWhatsapp(settings) {
  return Boolean(settings?.riskAcknowledged && settings?.hasEverPaired);
}

/**
 * Guard for every real WhatsApp run, wherever it starts (button, tray,
 * scheduler, catch-up).
 * @throws {Error} with a plain-English message
 */
export function assertCanSendWhatsapp(settings) {
  if (!canSendWhatsapp(settings)) {
    throw new Error("WhatsApp isn't set up yet. Open the Dashboard and choose \"Set up WhatsApp\" first.");
  }
}

/**
 * Where the user is with WhatsApp:
 *  "paired"       connected right now
 *  "disconnected" was paired before, not connected now (or unlinked)
 *  "never"        never set up
 */
export function whatsappSetupState(settings, waState) {
  if (waState?.status === "ready") return "paired";
  if (settings?.hasEverPaired) return "disconnected";
  return "never";
}

/**
 * The "Get started" checklist on the dashboard: three optional steps with live
 * status. `show` is false once the user hides it or everything is done.
 * @param {{settings: object, contactCount: number, emailReadyCount: number}} o
 */
export function onboardingChecklist({ settings, contactCount = 0, emailReadyCount = 0 }) {
  const items = [
    { key: "contacts", label: "Add your contacts", done: contactCount > 0 },
    { key: "whatsapp", label: "Set up WhatsApp", done: Boolean(settings?.hasEverPaired), optional: true },
    { key: "email", label: "Set up Email", done: emailReadyCount > 0, optional: true },
  ];
  const allDone = items.every((i) => i.done);
  return { items, allDone, show: !settings?.onboardingDismissed && !allDone };
}
