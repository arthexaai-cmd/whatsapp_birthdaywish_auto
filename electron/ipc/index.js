// Registers every IPC channel group against the (already-open) db and the
// main window. Called once from main.js after the window is created.

import { registerContactsIpc } from "./contacts.js";
import { registerMessagesIpc } from "./messages.js";
import { registerSettingsIpc } from "./settings.js";
import { registerWhatsappIpc } from "./whatsapp.js";
import { registerRunIpc } from "./run.js";
import { registerClockIpc } from "./clock.js";
import { registerReportsIpc } from "./reports.js";

export function registerAllIpc({ db, mainWindow, onScheduleChanged, onFactoryReset }) {
  registerContactsIpc(db);
  registerMessagesIpc(db);
  registerSettingsIpc(db, { onScheduleChanged, onFactoryReset });
  registerWhatsappIpc(db, mainWindow);
  registerRunIpc(db, mainWindow);
  registerClockIpc();
  registerReportsIpc(db);
}
