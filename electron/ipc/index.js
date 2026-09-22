// Registers every IPC channel group against the (already-open) db and the
// main window. Called once from main.js after the window is created.

import { registerContactsIpc } from "./contacts.js";
import { registerMessagesIpc } from "./messages.js";
import { registerSettingsIpc } from "./settings.js";
import { registerWhatsappIpc } from "./whatsapp.js";
import { registerRunIpc } from "./run.js";

export function registerAllIpc({ db, mainWindow, onScheduleChanged }) {
  registerContactsIpc(db);
  registerMessagesIpc(db);
  registerSettingsIpc(db, { onScheduleChanged });
  registerWhatsappIpc(db, mainWindow);
  registerRunIpc(db, mainWindow);
}
