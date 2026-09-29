// Guards the Excel import IPC. The renderer only ever passes back a path, so
// two things must be enforced in the main process:
//   * S3: only the file the user picked in the OS file dialog may be read --
//     not an arbitrary path a compromised renderer supplies.
//   * F10: what gets imported must be exactly what the preview showed. The
//     preview and the confirm each read the file, so an edit in between
//     (e.g. saving in Excel) would import different rows than were reviewed.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const norm = (p) => path.resolve(String(p)).toLowerCase(); // Windows paths are case-insensitive

export class ImportGuard {
  constructor() {
    this.pickedPath = null;
    this.previewHash = null;
  }

  /** Call when the user picks a file in the dialog. Starts a fresh preview cycle. */
  pick(filePath) {
    this.pickedPath = norm(filePath);
    this.previewHash = null;
  }

  assertPicked(filePath) {
    if (!this.pickedPath || norm(filePath) !== this.pickedPath) {
      throw new Error("Import refused: choose the file with the Import button first.");
    }
  }

  /** Call right after reading the file for the preview. */
  recordPreview(filePath) {
    this.assertPicked(filePath);
    this.previewHash = hashFile(filePath);
  }

  /** Call before importing for real; throws if the file changed since the preview. */
  assertUnchangedSincePreview(filePath) {
    this.assertPicked(filePath);
    if (!this.previewHash) throw new Error("Import refused: preview the file before importing it.");
    if (hashFile(filePath) !== this.previewHash) {
      throw new Error("The file changed after the preview. Choose it again to review the new contents.");
    }
  }

  /** After a successful import, the same preview can't be replayed. */
  reset() {
    this.pickedPath = null;
    this.previewHash = null;
  }
}
