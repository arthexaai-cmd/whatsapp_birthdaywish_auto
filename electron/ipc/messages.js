// IPC: template pool (on-time/belated messages) + {wish}-style variable
// pool editing, and live sample rendering for the Messages screen.

import { ipcMain } from "electron";
import { listTemplates, addTemplate, setTemplateEnabled, deleteTemplate, getMessagesConfig } from "../../src/core/db.js";
import { renderMessage } from "../../src/core/messages.js";

export function registerMessagesIpc(db) {
  ipcMain.handle("messages:listTemplates", () => listTemplates(db));

  ipcMain.handle("messages:addTemplate", (event, { kind, text }) => addTemplate(db, kind, text));

  ipcMain.handle("messages:setTemplateEnabled", (event, { id, enabled }) => {
    setTemplateEnabled(db, id, enabled);
    return { ok: true };
  });

  ipcMain.handle("messages:deleteTemplate", (event, id) => {
    deleteTemplate(db, id);
    return { ok: true };
  });

  ipcMain.handle("messages:preview", (event, { count = 8 } = {}) => {
    const cfg = getMessagesConfig(db);
    const samplePerson = { firstName: "Alex", salutation: null, customMessage: null };
    const samples = [];
    for (let i = 0; i < count; i++) {
      const belated = i % 3 === 0;
      samples.push({ belated, text: renderMessage(samplePerson, belated, cfg) });
    }
    return samples;
  });
}
