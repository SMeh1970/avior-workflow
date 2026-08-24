import { getGoogleAccessToken } from "./google-auth.mjs";
import { cloneWorkflow, mapEventRow, mapWorkflowRow, workflowToRow } from "./schema.mjs";

function quoteSheet(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}

function cellData(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { userEnteredValue: { numberValue: value } };
  }
  return { userEnteredValue: { stringValue: value == null ? "" : String(value) } };
}

export class GoogleSheetsStore {
  constructor(config) {
    this.config = config;
    this.baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}`;
    this.cache = null;
    this.cacheAt = 0;
  }

  async request(url, options = {}) {
    const token = await getGoogleAccessToken(this.config);
    const headers = {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(url, {
      ...options,
      headers
    });
    if (!response.ok) {
      const error = new Error(`Google Sheets: ${response.status} ${await response.text()}`);
      error.code = response.status === 409 || response.status === 412 ? "CONFLICT" : "GOOGLE_SHEETS";
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  async readRange(a1) {
    const url = `${this.baseUrl}/values/${encodeURIComponent(a1)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const payload = await this.request(url, { method: "GET" });
    return payload.values || [];
  }

  async readState(force = false) {
    if (!force && this.cache && Date.now() - this.cacheAt < 300_000) {
      return {
        workflows: this.cache.workflows.map(cloneWorkflow),
        events: this.cache.events.map((event) => ({ ...event, raw: [...event.raw] }))
      };
    }
    const [workflowRows, eventRows] = await Promise.all([
      this.readRange(`${quoteSheet(this.config.workflowSheetTitle)}!A:P`),
      this.readRange(`${quoteSheet(this.config.eventsSheetTitle)}!A:R`)
    ]);
    this.cache = {
      workflows: workflowRows.slice(1).map((row, index) => mapWorkflowRow(row, index + 2)),
      events: eventRows.slice(1).map((row, index) => mapEventRow(row, index + 2))
    };
    this.cacheAt = Date.now();
    return this.readState(false);
  }

  async applyTransaction({ before, after, eventRow }) {
    const workflowRow = workflowToRow(after);
    const body = {
      requests: [
        {
          updateCells: {
            range: {
              sheetId: this.config.workflowSheetId,
              startRowIndex: before.rowNumber - 1,
              endRowIndex: before.rowNumber,
              startColumnIndex: 0,
              endColumnIndex: workflowRow.length
            },
            rows: [{ values: workflowRow.map(cellData) }],
            fields: "userEnteredValue"
          }
        },
        {
          appendCells: {
            sheetId: this.config.eventsSheetId,
            rows: [{ values: eventRow.map(cellData) }],
            fields: "userEnteredValue"
          }
        }
      ]
    };
    await this.request(`${this.baseUrl}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (this.cache) {
      const index = this.cache.workflows.findIndex((item) => item.workflowId === before.workflowId);
      if (index >= 0) this.cache.workflows[index] = mapWorkflowRow(workflowRow, before.rowNumber);
      this.cache.events.push(mapEventRow(eventRow, this.cache.events.length + 2));
      this.cacheAt = Date.now();
    }
    return { workflow: after, eventId: eventRow[0] };
  }
}
