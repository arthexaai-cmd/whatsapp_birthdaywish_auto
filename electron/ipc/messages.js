// IPC: template pool (on-time/belated messages) + {wish}-style variable
// pool editing, and live sample rendering for the Messages screen.

import { ipcMain } from "electron";
import {
  listTemplates,
  addTemplate,
  updateTemplateText,
  setTemplateEnabled,
  deleteTemplate,
  listTemplateVars,
  addTemplateVar,
  updateTemplateVar,
  deleteTemplateVar,
  getMessagesConfig,
  getAllSettings,
} from "../../src/core/db.js";
import { renderMessage, namePostfixFrom } from "../../src/core/messages.js";

export function registerMessagesIpc(db) {
  ipcMain.handle("messages:listTemplates", () => listTemplates(db));

  ipcMain.handle("messages:addTemplate", (event, { kind, text }) => addTemplate(db, kind, text));

  ipcMain.handle("messages:updateTemplate", (event, { id, text }) => {
    if (typeof text !== "string" || !text.trim()) throw new Error("Template text can't be empty.");
    updateTemplateText(db, id, text);
    return { ok: true };
  });

  ipcMain.handle("messages:setTemplateEnabled", (event, { id, enabled }) => {
    setTemplateEnabled(db, id, enabled);
    return { ok: true };
  });

  ipcMain.handle("messages:deleteTemplate", (event, id) => {
    deleteTemplate(db, id);
    return { ok: true };
  });

  ipcMain.handle("messages:listVars", () => listTemplateVars(db));

  ipcMain.handle("messages:addVar", (event, { name, value }) => {
    if (typeof name !== "string" || !name.trim()) throw new Error("Variable name can't be empty.");
    if (typeof value !== "string" || !value.trim()) throw new Error("Variable text can't be empty.");
    return addTemplateVar(db, name.trim(), value);
  });

  ipcMain.handle("messages:updateVar", (event, { id, value }) => {
    if (typeof value !== "string" || !value.trim()) throw new Error("Variable text can't be empty.");
    updateTemplateVar(db, id, value);
    return { ok: true };
  });

  ipcMain.handle("messages:deleteVar", (event, id) => {
    deleteTemplateVar(db, id);
    return { ok: true };
  });

  ipcMain.handle("messages:preview", (event, { count = 8 } = {}) => {
    const cfg = getMessagesConfig(db);
    const postfix = namePostfixFrom(getAllSettings(db));
    const samplePerson = { firstName: "Alex", salutation: null, customMessage: null };
    const samples = [];
    for (let i = 0; i < count; i++) {
      const belated = i % 3 === 0;
      samples.push({ belated, text: renderMessage(samplePerson, belated, cfg, Math.random, postfix) });
    }
    return samples;
  });
}
