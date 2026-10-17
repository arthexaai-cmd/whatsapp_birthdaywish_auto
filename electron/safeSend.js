// Sends an IPC event to the renderer only if the window (and its
// webContents) are still alive. Needed because event listeners on
// long-lived singletons (whatsappManager, emailManager, updater) can fire
// asynchronously after the window has already been destroyed -- window
// close, factory reset's app.exit(0), or app quit racing an in-flight
// WhatsApp disconnect event -- and webContents.send() on a destroyed
// window throws "Object has been destroyed" as an uncaught exception.
export function safeSend(win, channel, ...args) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, ...args);
}
