// Where the birthday-card files live. cardsDir holds the user's uploaded
// picture (inside the app's data folder); assetsDir holds the bundled fonts and
// starter picture (extraResources when packaged, the repo's assets/ in dev).

import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

export function cardPaths(userDataPath = app.getPath("userData")) {
  const cardsDir = path.join(userDataPath, "cards");
  const packaged = path.join(process.resourcesPath || "", "assets");
  const assetsDir = app.isPackaged && fs.existsSync(packaged) ? packaged : path.join(app.getAppPath(), "assets");
  return { cardsDir, assetsDir };
}
