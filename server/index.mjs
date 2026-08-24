import http from "node:http";
import process from "node:process";
import readline from "node:readline";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config.mjs";
import { createMcpHandler } from "./mcp.mjs";
import { createStore } from "./store-factory.mjs";

const config = getConfig();
const store = await createStore(config);
const widgetHtmlText = await readFile(path.join(config.root, "public", "avior-workflow.html"), "utf8");
const handleMcp = createMcpHandler({ store, config, widgetHtmlText });

async function dispatch(payload) {
  if (Array.isArray(payload)) {
    const results = (await Promise.all(payload.map(handleMcp))).filter(Boolean);
    return results.length ? results : null;
  }
  return handleMcp(payload);
}

function writeJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,mcp-session-id,mcp-protocol-version",
    ...headers
  });
  response.end(payload == null ? "" : JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Слишком большой MCP-запрос.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function startHttp() {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") return writeJson(response, 204, null);
      if (request.method === "GET" && request.url === "/health") {
        return writeJson(response, 200, {
          status: "ok",
          service: "avior-workflow",
          version: "0.1.0",
          storage: config.storage,
          gmail: "disabled"
        });
      }
      if (request.method === "GET" && request.url === "/") {
        return writeJson(response, 200, {
          service: "avior-workflow",
          mcp: "/mcp",
          health: "/health"
        });
      }
      if (request.url !== "/mcp") return writeJson(response, 404, { error: "Not found" });
      if (request.method !== "POST") {
        return writeJson(response, 405, { error: "Use POST /mcp" }, { allow: "POST, OPTIONS" });
      }
      const result = await dispatch(await readBody(request));
      if (result == null) return writeJson(response, 202, null);
      return writeJson(response, 200, result, { "mcp-protocol-version": "2025-06-18" });
    } catch (error) {
      return writeJson(response, 400, { error: error.message || "Bad request" });
    }
  });
  server.listen(config.port, "0.0.0.0", () => {
    process.stderr.write(`АВИОР Workflow: http://0.0.0.0:${config.port}/mcp (${config.storage})\n`);
  });
}

function startStdio() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", async (line) => {
    if (!line.trim()) return;
    try {
      const result = await dispatch(JSON.parse(line));
      if (result != null) process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } })}\n`
      );
    }
  });
}

if (process.argv.includes("--stdio")) startStdio();
else startHttp();
