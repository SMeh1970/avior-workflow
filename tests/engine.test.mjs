import assert from "node:assert/strict";
import test from "node:test";
import { getConfig, loadSampleState } from "../server/config.mjs";
import { applyWorkflowAnswer, openWorkflow, undoLastTransaction } from "../server/engine.mjs";
import { MemoryStore } from "../server/memory-store.mjs";

const timezone = "Europe/Istanbul";

async function fixture() {
  const config = getConfig();
  return new MemoryStore(await loadSampleState(config));
}

test("opens the first active workflow", async () => {
  const store = await fixture();
  const dashboard = await openWorkflow(store, timezone);
  assert.equal(dashboard.openCount, 2);
  assert.equal(dashboard.current.workflowId, "WF-DEMO-DELIVERY");
  assert.equal(dashboard.current.question, "Товар уже получен?");
});

test("pending -> date -> time creates a deterministic control chain", async () => {
  const store = await fixture();
  let result = await applyWorkflowAnswer(
    store,
    { workflow_id: "WF-DEMO-DELIVERY", answer: "Нет, ждём" },
    timezone
  );
  assert.equal(result.current.workflowId, "WF-DEMO-DELIVERY");
  assert.equal(result.current.question, "Когда проверить снова?");

  result = await applyWorkflowAnswer(
    store,
    {
      workflow_id: "WF-DEMO-DELIVERY",
      answer: "Сегодня",
      expected_event_id: result.current.lastEvent
    },
    timezone
  );
  assert.match(result.current.question, /^Во сколько/);

  result = await applyWorkflowAnswer(
    store,
    {
      workflow_id: "WF-DEMO-DELIVERY",
      answer: "15:00",
      expected_event_id: result.current.lastEvent
    },
    timezone
  );
  const scheduled = result.queue.find((item) => item.workflowId === "WF-DEMO-DELIVERY");
  assert.equal(scheduled.controlTime, "15:00");
  assert.equal(scheduled.question, "Товар уже получен?");
});

test("success closes only the selected workflow", async () => {
  const store = await fixture();
  const result = await applyWorkflowAnswer(
    store,
    { workflow_id: "WF-DEMO-DELIVERY", answer: "Да, получен полностью" },
    timezone
  );
  assert.equal(result.openCount, 1);
  assert.equal(result.current.workflowId, "WF-DEMO-INVOICE");
  const state = await store.readState();
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].eventType, "DELIVERY_RECEIVED");
});

test("Gmail option never writes the register", async () => {
  const store = await fixture();
  const result = await applyWorkflowAnswer(
    store,
    { workflow_id: "WF-DEMO-INVOICE", answer: "Проверить Gmail" },
    timezone
  );
  assert.equal(result.requiresAi, true);
  const state = await store.readState();
  assert.equal(state.events.length, 0);
});

test("undo appends a compensating event and restores the workflow", async () => {
  const store = await fixture();
  await applyWorkflowAnswer(
    store,
    { workflow_id: "WF-DEMO-DELIVERY", answer: "Да, получен полностью" },
    timezone
  );
  const result = await undoLastTransaction(store, timezone);
  assert.equal(result.openCount, 2);
  const state = await store.readState();
  assert.equal(state.events.at(-1).eventType, "TRANSACTION_UNDONE");
  assert.equal(state.workflows[0].question, "Товар уже получен?");
});
