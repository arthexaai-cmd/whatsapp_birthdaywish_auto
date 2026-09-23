// The only surface the renderer can reach into main through. Deliberately
// narrow: every channel is explicit, no raw ipcRenderer is exposed, and
// nodeIntegration stays off in the renderer (see main.js's webPreferences).
//
// CommonJS (.cjs) rather than ESM: Electron's preload loader supports CJS
// unconditionally across versions, avoiding ESM-preload edge cases even
// though the rest of the app (package.json "type": "module") is ESM.

const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const listener = (event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("api", {
  contacts: {
    list: () => ipcRenderer.invoke("contacts:list"),
    upsert: (contact) => ipcRenderer.invoke("contacts:upsert", contact),
    delete: (id) => ipcRenderer.invoke("contacts:delete", id),
    pickExcelFile: () => ipcRenderer.invoke("contacts:pickExcelFile"),
    previewImport: (filePath) => ipcRenderer.invoke("contacts:previewImport", filePath),
    confirmImport: (filePath) => ipcRenderer.invoke("contacts:confirmImport", filePath),
  },
  messages: {
    listTemplates: () => ipcRenderer.invoke("messages:listTemplates"),
    addTemplate: (kind, text) => ipcRenderer.invoke("messages:addTemplate", { kind, text }),
    setTemplateEnabled: (id, enabled) => ipcRenderer.invoke("messages:setTemplateEnabled", { id, enabled }),
    deleteTemplate: (id) => ipcRenderer.invoke("messages:deleteTemplate", id),
    preview: (count) => ipcRenderer.invoke("messages:preview", { count }),
  },
  settings: {
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    set: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
    appInfo: () => ipcRenderer.invoke("settings:appInfo"),
  },
  history: {
    listRuns: (limit) => ipcRenderer.invoke("history:listRuns", limit),
    getRunSends: (runId) => ipcRenderer.invoke("history:getRunSends", runId),
  },
  whatsapp: {
    getState: () => ipcRenderer.invoke("whatsapp:getState"),
    checkBrowser: () => ipcRenderer.invoke("whatsapp:checkBrowser"),
    downloadChromium: () => ipcRenderer.invoke("whatsapp:downloadChromium"),
    connect: () => ipcRenderer.invoke("whatsapp:connect"),
    unlink: () => ipcRenderer.invoke("whatsapp:unlink"),
    disconnect: () => ipcRenderer.invoke("whatsapp:disconnect"),
    onState: (callback) => on("whatsapp:state", callback),
    onDownloadProgress: (callback) => on("whatsapp:downloadProgress", callback),
  },
  run: {
    start: (opts) => ipcRenderer.invoke("run:start", opts),
    cancel: () => ipcRenderer.invoke("run:cancel"),
    isActive: () => ipcRenderer.invoke("run:isActive"),
    onProgress: (callback) => on("run:progress", callback),
    onAutoStarted: (callback) => on("run:autoStarted", callback),
  },
  tray: {
    onRunNow: (callback) => on("tray:runNow", callback),
    onToggleScheduling: (callback) => on("tray:toggleScheduling", callback),
  },
  clock: {
    check: () => ipcRenderer.invoke("clock:check"),
    openDateTimeSettings: () => ipcRenderer.invoke("clock:openDateTimeSettings"),
  },
});
