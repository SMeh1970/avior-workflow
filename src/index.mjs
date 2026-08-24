import widgetHtmlText from "../public/avior-workflow.html";
import { GoogleSheetsStore } from "../server/google-sheets-store.mjs";
import { createMcpHandler } from "../server/mcp.mjs";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers":
    "content-type,authorization,accept,mcp-session-id,mcp-protocol-version",
  "access-control-expose-headers": "mcp-session-id,mcp-protocol-version"
};

let runtime;

function integer(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRuntime(env) {
  if (runtime) return runtime;
  const config = {
    storage: "google",
    timezone: env.AVIOR_TIMEZONE || "Europe/Istanbul",
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID || "13ZY5KPc2Zn6NQzrPDlrB-7jRhqq-JogfOwwVKx0QiJ4",
    workflowSheetTitle: env.GOOGLE_WORKFLOW_SHEET_TITLE || "Workflow V2",
    eventsSheetTitle: env.GOOGLE_EVENTS_SHEET_TITLE || "События V2",
    workflowSheetId: integer(env.GOOGLE_WORKFLOW_SHEET_ID, 1358772742),
    eventsSheetId: integer(env.GOOGLE_EVENTS_SHEET_ID, 388227625),
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
    serviceAccountJsonBase64: env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || ""
  };
  const store = new GoogleSheetsStore(config);
  runtime = { config, handleMcp: createMcpHandler({ store, config, widgetHtmlText }) };
  return runtime;
}

async function dispatch(handleMcp, payload) {
  if (Array.isArray(payload)) {
    const results = (await Promise.all(payload.map(handleMcp))).filter(Boolean);
    return results.length ? results : null;
  }
  return handleMcp(payload);
}

function json(payload, status = 200, headers = {}) {
  return new Response(payload == null ? null : JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "avior-workflow", version: "0.2.2", storage: "google" });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return json({ service: "avior-workflow", mcp: "/mcp", health: "/health" });
    }
    if (url.pathname !== "/mcp") return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return json({ error: "Use POST /mcp" }, 405, { allow: "POST, OPTIONS" });
    try {
      const bodyText = await request.text();
      if (bodyText.length > 1_000_000) return json({ error: "Слишком большой MCP-запрос." }, 413);
      const payload = JSON.parse(bodyText || "{}");
      const result = await dispatch(getRuntime(env).handleMcp, payload);
      if (result == null) return new Response(null, { status: 202, headers: CORS_HEADERS });
      return json(result, 200, { "mcp-protocol-version": "2025-06-18" });
    } catch (error) {
      return json({ error: error?.message || "Bad request" }, 400);
    }
  }
};
