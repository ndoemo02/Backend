import fs from "fs";
import path from "path";

export function logCursorPatch(action, details) {
  const logFile = path.join(process.cwd(), "logs", "change-log.txt");
  const timestamp = new Date().toISOString().replace("T", " ").split(".")[0];
  const entry = `[${timestamp}] ${action}: ${details}\n`;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, entry, "utf8");
  console.log(`🪶 Cursor patch logged: ${action}`);
}
