import assert from "node:assert/strict";
import test from "node:test";
import { getConfig, loadSampleState } from "../server/config.mjs";
import { createMcpHandler, WIDGET_URI } from "../server/mcp.mjs";
import { MemoryStore } from "../server/memory-store.mjs";

async function handler() {
  const config = getConfig();
  const store = new MemoryStore(await loadSampleState(config));
  return createMcpHandler({ store, config });
}

test("MCP initialize advertises tools and resources", async () => {
  const handle = await handler();
  const initialized = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(initialized.result.serverInfo.name, "avior-workflow");
  const listed = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(listed.result.tools.length, 4);
});

test("widget resource and open tool return MCP Apps payloads", async () => {
  const handle = await handler();
  const resource = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: WIDGET_URI }
  });
  assert.match(resource.result.contents[0].text, /АВИОР Workflow/);
  const opened = await handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "open_avior_workflow", arguments: {} }
  });
  assert.equal(opened.result._meta["ui.resourceUri"], WIDGET_URI);
  assert.equal(opened.result.structuredContent.openCount, 2);
  assert.equal(opened.result.content[0].text, "Интерактивная карточка АВИОР открыта.");
  assert.doesNotMatch(opened.result.content[0].text, /Товар уже получен/);
});

test("stale answer refreshes the widget instead of returning an MCP error", async () => {
  const handle = await handler();
  const response = await handle({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "apply_avior_answer",
      arguments: {
        workflow_id: "WF-DEMO-DELIVERY",
        answer: "Нет, ждём",
        expected_event_id: "STALE-EVENT"
      }
    }
  });
  assert.equal(response.error, undefined);
  assert.equal(response.result.structuredContent.current.workflowId, "WF-DEMO-DELIVERY");
  assert.match(response.result.structuredContent.message, /автоматически обновлена/);
});
