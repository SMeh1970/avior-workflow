import { cloneWorkflow, mapEventRow, mapWorkflowRow, workflowToRow } from "./schema.mjs";

export class MemoryStore {
  constructor(sampleState) {
    this.workflowHeader = [...sampleState.workflows[0]];
    this.eventHeader = [...sampleState.events[0]];
    this.workflows = sampleState.workflows.slice(1).map((row, index) => mapWorkflowRow(row, index + 2));
    this.events = sampleState.events.slice(1).map((row, index) => mapEventRow(row, index + 2));
  }

  async readState() {
    return {
      workflows: this.workflows.map(cloneWorkflow),
      events: this.events.map((event) => ({ ...event, raw: [...event.raw] }))
    };
  }

  async applyTransaction({ before, after, eventRow }) {
    const index = this.workflows.findIndex((item) => item.workflowId === before.workflowId);
    if (index < 0) throw new Error(`Workflow ${before.workflowId} не найден.`);
    if (this.workflows[index].lastEvent !== before.lastEvent) {
      const error = new Error("Строка была изменена другим действием. Обновите состояние.");
      error.code = "CONFLICT";
      throw error;
    }
    const normalizedAfter = mapWorkflowRow(workflowToRow(after), before.rowNumber);
    this.workflows[index] = normalizedAfter;
    this.events.push(mapEventRow(eventRow, this.events.length + 2));
    return { workflow: cloneWorkflow(normalizedAfter), eventId: eventRow[0] };
  }
}
