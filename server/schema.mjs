export const WORKFLOW_HEADERS = [
  "ID workflow",
  "ID заказа",
  "№ нашего счёта",
  "ID позиции",
  "Текущее состояние",
  "Ожидаемое событие",
  "Вопрос пользователю",
  "Вариант 1",
  "Вариант 2",
  "Вариант 3",
  "Вариант 4",
  "Контрольная дата",
  "Контрольное время",
  "Статус контроля",
  "Последнее событие",
  "Примечание"
];

export const EVENT_HEADERS = [
  "ID события",
  "Дата/время",
  "ID заказа",
  "№ нашего счёта",
  "ID позиции",
  "Тип события",
  "Количество",
  "Ед.",
  "Контрагент",
  "Документ №",
  "Источник",
  "Ссылка/ID источника",
  "Подтверждение",
  "Предыдущее состояние",
  "Новое состояние",
  "Следующий этап",
  "Срок следующего этапа",
  "Комментарий"
];

function cell(value) {
  return value == null ? "" : String(value);
}

export function mapWorkflowRow(row, rowNumber) {
  const r = Array.from({ length: WORKFLOW_HEADERS.length }, (_, index) => cell(row[index]));
  return {
    rowNumber,
    workflowId: r[0],
    orderId: r[1],
    invoiceNo: r[2],
    positionId: r[3],
    currentState: r[4],
    expectedEvent: r[5],
    question: r[6],
    options: r.slice(7, 11).filter(Boolean),
    controlDate: r[11],
    controlTime: r[12],
    controlStatus: r[13],
    lastEvent: r[14],
    note: r[15]
  };
}

export function workflowToRow(workflow) {
  const options = [...(workflow.options || []), "", "", "", ""].slice(0, 4);
  return [
    workflow.workflowId,
    workflow.orderId,
    workflow.invoiceNo,
    workflow.positionId,
    workflow.currentState,
    workflow.expectedEvent,
    workflow.question,
    ...options,
    workflow.controlDate,
    workflow.controlTime,
    workflow.controlStatus,
    workflow.lastEvent,
    workflow.note
  ].map(cell);
}

export function mapEventRow(row, rowNumber) {
  const r = Array.from({ length: EVENT_HEADERS.length }, (_, index) => cell(row[index]));
  return {
    rowNumber,
    eventId: r[0],
    occurredAt: r[1],
    orderId: r[2],
    invoiceNo: r[3],
    positionId: r[4],
    eventType: r[5],
    quantity: r[6],
    unit: r[7],
    counterparty: r[8],
    documentNo: r[9],
    source: r[10],
    sourceId: r[11],
    confirmation: r[12],
    previousState: r[13],
    newState: r[14],
    nextStage: r[15],
    deadline: r[16],
    comment: r[17],
    raw: r
  };
}

export function cloneWorkflow(workflow) {
  return { ...workflow, options: [...(workflow.options || [])] };
}
