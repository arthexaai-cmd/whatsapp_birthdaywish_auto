// Copies everything the main process prints (console.*, including the
// browser output Puppeteer attaches to a launch error) into
// `<userData>/main.log`.
//
// The installed app has no console, so before this a failure on someone
// else's PC (e.g. the browser not starting) left nothing to diagnose. The log
// is kept small: at startup a file over MAX_BYTES is moved to main.old.log, so
// at most two files of that size exist.

import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;

export function logFilePath(userDataPath) {
  return path.join(userDataPath, "main.log");
}

/** Start mirroring stdout/stderr into main.log. Never throws: logging must not stop the app. */
export function installLogFile(userDataPath) {
  let stream;
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    const file = logFilePath(userDataPath);
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, path.join(userDataPath, "main.old.log"));
    }
    stream = fs.createWriteStream(file, { flags: "a" });
    stream.on("error", () => {}); // e.g. disk full: keep running without the log
  } catch {
    return;
  }

  for (const name of ["stdout", "stderr"]) {
    const target = process[name];
    const original = target.write.bind(target);
    target.write = (chunk, ...rest) => {
      try {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        stream.write(`${new Date().toISOString()} ${name === "stderr" ? "ERR" : "   "} ${text}${text.endsWith("\n") ? "" : "\n"}`);
      } catch {}
      try {
        return original(chunk, ...rest);
      } catch {
        return true; // no console attached (packaged GUI app)
      }
    };
  }
  console.log(`[main] Birthday Bot starting; log file ${logFilePath(userDataPath)}`);
}
