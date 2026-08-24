import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function integer(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfig() {
  const storage = process.env.AVIOR_STORAGE || "memory";
  return {
    root,
    port: integer(process.env.PORT, 8787),
    storage,
    timezone: process.env.AVIOR_TIMEZONE || "Europe/Istanbul",
    spreadsheetId:
      process.env.GOOGLE_SPREADSHEET_ID || "13ZY5KPc2Zn6NQzrPDlrB-7jRhqq-JogfOwwVKx0QiJ4",
    workflowSheetTitle: process.env.GOOGLE_WORKFLOW_SHEET_TITLE || "Workflow V2",
    eventsSheetTitle: process.env.GOOGLE_EVENTS_SHEET_TITLE || "События V2",
    workflowSheetId: integer(process.env.GOOGLE_WORKFLOW_SHEET_ID, 1358772742),
    eventsSheetId: integer(process.env.GOOGLE_EVENTS_SHEET_ID, 388227625),
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    serviceAccountJsonBase64: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ""
  };
}

export async function loadSampleState(config = getConfig()) {
  const raw = await readFile(path.join(config.root, "config", "sample-state.json"), "utf8");
  return JSON.parse(raw);
}
