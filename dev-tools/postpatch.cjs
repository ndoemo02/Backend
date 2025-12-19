import { logCursorPatch } from "./patchLogger.js";

const args = process.argv.slice(2).join(" ");
logCursorPatch("Patch applied", args || "No description provided");
