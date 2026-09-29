// IPC: the Reports tab -- progress so far + upcoming schedule, and the Excel
// export of both. All the actual logic is in src/core/progress.js.

import { app, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import { getAllSettings } from "../../src/core/db.js";
import { buildProgressReport, buildUpcomingSchedule, writeReportXlsx } from "../../src/core/progress.js";

function buildReport(db, days) {
  const settings = getAllSettings(db);
  return {
    progress: buildProgressReport(db),
    upcoming: buildUpcomingSchedule(db, settings, { days }),
  };
}

export function registerReportsIpc(db) {
  ipcMain.handle("reports:get", (event, { days = 365 } = {}) => buildReport(db, days));

  ipcMain.handle("reports:export", async (event, { days = 365 } = {}) => {
    const report = buildReport(db, days);
    const result = await dialog.showSaveDialog({
      title: "Export report",
      defaultPath: path.join(app.getPath("documents"), `birthday-bot-report-${report.upcoming.meta.today}.xlsx`),
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeReportXlsx(result.filePath, report);
    shell.showItemInFolder(result.filePath);
    return result.filePath;
  });
}
