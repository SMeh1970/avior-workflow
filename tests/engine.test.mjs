import assert from "node:assert/strict";
import test from "node:test";
import { getConfig, loadSampleState } from "../server/config.mjs";
import {
  applyWorkflowAnswer,
  controlTimeOptions,
  openWorkflow,
  undoLastTransaction
} from "../server/engine.mjs";
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
  assert.equal(
    result.current.question,
    "Когда снова проверить: «Товар уже получен?»"
  );

  result = await applyWorkflowAnswer(
    store,
    {
      workflow_id: "WF-DEMO-DELIVERY",
      answer: "Завтра",
      expected_event_id: result.current.lastEvent
    },
    timezone
  );
  assert.equal(
    result.current.question,
    "Во сколько завтра проверить: «Товар уже получен?»"
  );

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

test("same-day time options never include past slots", () => {
  const now = new Date("2026-08-24T14:27:00.000Z");
  assert.deepEqual(controlTimeOptions("24.08.2026", timezone, now), [
    "18:00",
    "19:00",
    "21:00",
    "Другое время"
  ]);
});

test("future controls are visible but cannot be answered early", async () => {
  const store = await fixture();
  let result = await applyWorkflowAnswer(
    store,
    { workflow_id: "WF-DEMO-DELIVERY", answer: "Нет, ждём" },
    timezone
  );
  result = await applyWorkflowAnswer(
    store,
    {
      workflow_id: "WF-DEMO-DELIVERY",
      answer: "31.12.2099",
      expected_event_id: result.current.lastEvent
    },
    timezone
  );
  await applyWorkflowAnswer(
    store,
    {
      workflow_id: "WF-DEMO-DELIVERY",
      answer: "10:00",
      expected_event_id: result.current.lastEvent
    },
    timezone
  );
  const dashboard = await openWorkflow(store, timezone);
  const future = dashboard.queue.find((item) => item.workflowId === "WF-DEMO-DELIVERY");
  assert.equal(future.due, false);
  assert.deepEqual(future.options, []);
  await assert.rejects(
    applyWorkflowAnswer(
      store,
      { workflow_id: "WF-DEMO-DELIVERY", answer: "Да, получен полностью" },
      timezone
    ),
    (error) => error.code === "FUTURE_CONTROL"
  );
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
