import { cloneWorkflow, mapEventRow, workflowToRow } from "./schema.mjs";
import { base64UrlToUtf8, utf8ToBase64Url } from "./base64.mjs";

const META_PREFIX = "AVIOR_META:";
const TX_PREFIX = "AVIOR_TX:";
const UNDO_PREFIX = "AVIOR_UNDO:";

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return parts;
}

function displayDate(parts) {
  return `${parts.day}.${parts.month}.${parts.year}`;
}

function displayDateTime(date, timezone) {
  const parts = localParts(date, timezone);
  return `${displayDate(parts)} ${parts.hour}:${parts.minute}`;
}

function today(timezone, offsetDays = 0) {
  const now = new Date();
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  return displayDate(localParts(shifted, timezone));
}

function yearInTimezone(timezone) {
  return localParts(new Date(), timezone).year;
}

function dateKey(display, time = "00:00") {
  const match = String(display || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  return `${match[3]}${match[2]}${match[1]}${String(time || "00:00").replace(":", "")}`;
}

function nowKey(timezone) {
  const p = localParts(new Date(), timezone);
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

function isClosed(workflow) {
  const status = normalize(workflow.controlStatus);
  const expected = normalize(workflow.expectedEvent);
  return (
    !workflow.question ||
    workflow.question === "—" ||
    status === "выполнено" ||
    status.startsWith("закрыто") ||
    expected === "закрыто"
  );
}

function dueRank(workflow, timezone) {
  if (!workflow.controlTime && normalize(workflow.controlStatus).includes("ожидается время")) {
    return { group: 0, key: "" };
  }
  const key = dateKey(workflow.controlDate, workflow.controlTime || "23:59");
  if (!key) return { group: 1, key: "" };
  return key <= nowKey(timezone) ? { group: 0, key } : { group: 2, key };
}

export function selectNextWorkflow(workflows, timezone, requestedId = "") {
  const active = workflows.filter((workflow) => !isClosed(workflow));
  const requested = active.find((workflow) => workflow.workflowId === requestedId);
  if (requested) return requested;
  return [...active].sort((a, b) => {
    const left = dueRank(a, timezone);
    const right = dueRank(b, timezone);
    if (left.group !== right.group) return left.group - right.group;
    if (left.key !== right.key) return left.key.localeCompare(right.key);
    return a.rowNumber - b.rowNumber;
  })[0] || null;
}

function publicWorkflow(workflow, timezone) {
  if (!workflow) return null;
  const rank = dueRank(workflow, timezone);
  return {
    workflowId: workflow.workflowId,
    orderId: workflow.orderId,
    invoiceNo: workflow.invoiceNo,
    positionId: workflow.positionId,
    currentState: workflow.currentState,
    expectedEvent: workflow.expectedEvent,
    question: workflow.question,
    options: workflow.options,
    controlDate: workflow.controlDate,
    controlTime: workflow.controlTime,
    controlStatus: workflow.controlStatus,
    lastEvent: workflow.lastEvent,
    due: rank.group !== 2
  };
}

export function buildDashboard(state, timezone, requestedId = "") {
  const active = state.workflows.filter((workflow) => !isClosed(workflow));
  const current = selectNextWorkflow(state.workflows, timezone, requestedId);
  const ordered = [...active].sort((a, b) => {
    const left = dueRank(a, timezone);
    const right = dueRank(b, timezone);
    return left.group - right.group || left.key.localeCompare(right.key) || a.rowNumber - b.rowNumber;
  });
  return {
    version: "0.2.0",
    generatedAt: displayDateTime(new Date(), timezone),
    timezone,
    openCount: active.length,
    current: publicWorkflow(current, timezone),
    queue: ordered.slice(0, 12).map((workflow) => publicWorkflow(workflow, timezone))
  };
}

function encode(value) {
  return utf8ToBase64Url(JSON.stringify(value));
}

function decode(value) {
  return JSON.parse(base64UrlToUtf8(value));
}

function readMeta(note) {
  const matches = [...String(note || "").matchAll(/AVIOR_META:([A-Za-z0-9_-]+)/g)];
  if (!matches.length) return {};
  try {
    return decode(matches.at(-1)[1]);
  } catch {
    return {};
  }
}

function writeMeta(note, meta) {
  const clean = String(note || "").replace(/\s*AVIOR_META:[A-Za-z0-9_-]+/g, "").trim();
  return `${clean}${clean ? " " : ""}${META_PREFIX}${encode(meta)}`;
}

function classify(answer, freeText = "") {
  const text = normalize(freeText || answer);
  if (text.includes("gmail") || text.includes("почт")) return { kind: "requires_ai", text };
  const timeMatch = text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:$|\s)/);
  if (timeMatch) return { kind: "time", value: `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` };
  const dateMatch = text.match(/(?:^|\s)(\d{2})[.-](\d{2})[.-](\d{4})(?:$|\s)/);
  if (dateMatch) return { kind: "date_absolute", value: `${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}` };
  const isoDateMatch = text.match(/(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?:$|\s)/);
  if (isoDateMatch) return { kind: "date_absolute", value: `${isoDateMatch[3]}.${isoDateMatch[2]}.${isoDateMatch[1]}` };
  if (text === "сегодня" || text.includes("сегодня")) return { kind: "date", offsetDays: 0 };
  if (text === "завтра" || text.includes("завтра")) return { kind: "date", offsetDays: 1 };
  if (text.includes("срок неизвест") || text.includes("неизвестен")) return { kind: "unknown_date" };
  if (text.includes("сроки разные")) return { kind: "details", text: freeText || answer };
  if (text.includes("проблем")) return { kind: "issue", text: freeText || answer };
  if (text.includes("частич") || text.includes("часть")) return { kind: "partial", text: freeText || answer };
  if (
    text.startsWith("нет") ||
    text.includes("не получ") ||
    text.includes("не довез") ||
    text.includes("ещё жд") ||
    text.includes("еще жд")
  ) {
    return { kind: "pending", text: freeText || answer };
  }
  if (
    text.startsWith("да") ||
    text.includes("получен") ||
    text.includes("довез") ||
    text.includes("оплачен") ||
    text.includes("закрыт")
  ) {
    return { kind: "success", text: freeText || answer };
  }
  return { kind: "details", text: freeText || answer };
}

function eventTypeFor(kind, question) {
  const q = normalize(question);
  if (kind === "time") return "CONTROL_TIME_SET";
  if (kind === "date" || kind === "date_absolute") return "EXPECTED_DATE_SET";
  if (kind === "unknown_date") return "DELIVERY_DATE_UNKNOWN";
  if (kind === "issue") return "ISSUE_REPORTED";
  if (kind === "details") return "DETAILS_RECORDED";
  if (kind === "partial") {
    if (q.includes("счёт") || q.includes("счет")) return "SUPPLIER_INVOICES_PARTIALLY_RECEIVED";
    return "PARTIAL_DELIVERY_CONFIRMED";
  }
  if (kind === "pending") {
    if (q.includes("счёт") || q.includes("счет")) return "SUPPLIER_INVOICES_PENDING";
    if (q.includes("накладн")) return "SIGNED_DELIVERY_NOTE_PENDING";
    if (q.includes("оплат")) return "PAYMENT_PENDING";
    return "DELIVERY_PENDING";
  }
  if (q.includes("счёт") || q.includes("счет")) return "SUPPLIER_INVOICES_RECEIVED";
  if (q.includes("накладн")) return "SIGNED_DELIVERY_NOTE_RECEIVED";
  if (q.includes("оплат")) return "PAYMENT_CONFIRMED";
  if (q.includes("возврат")) return "REFUND_RECEIVED";
  if (q.includes("довез") || q.includes("получ") || q.includes("постав")) return "DELIVERY_RECEIVED";
  return "STATUS_CONFIRMED";
}

function nextSequence(events, invoiceNo, year) {
  const invoice = /^\d+$/.test(invoiceNo || "")
    ? String(invoiceNo).padStart(4, "0")
    : String(invoiceNo || "GEN").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "GEN";
  const prefix = `EVT-${year}-${invoice}-`;
  const sequence = events.reduce((max, event) => {
    if (!event.eventId.startsWith(prefix)) return max;
    const value = Number.parseInt(event.eventId.slice(prefix.length), 10);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return `${prefix}${String(sequence + 1).padStart(3, "0")}`;
}

function txMetadata(before, after, answer, eventId) {
  return {
    kind: "transaction",
    eventId,
    workflowId: before.workflowId,
    rowNumber: before.rowNumber,
    beforeRow: workflowToRow(before),
    afterRow: workflowToRow(after),
    answer
  };
}

function buildEventRow({ eventId, before, after, eventType, answer, timezone, deadline = "" }) {
  const tx = txMetadata(before, after, answer, eventId);
  return [
    eventId,
    displayDateTime(new Date(), timezone),
    before.orderId,
    before.invoiceNo,
    before.positionId,
    eventType,
    "",
    "",
    "",
    "",
    "Плагин АВИОР",
    "Прямое действие кнопки",
    "Подтверждено пользователем",
    before.currentState,
    after.currentState,
    after.expectedEvent,
    deadline,
    `Ответ пользователя: «${answer}». ${TX_PREFIX}${encode(tx)}`
  ];
}

function applyTransition(before, classification, answer, timezone) {
  const after = cloneWorkflow(before);
  const originalMeta = readMeta(before.note);
  const baseMeta = originalMeta.baseQuestion
    ? originalMeta
    : { baseQuestion: before.question, baseOptions: before.options };
  const answerText = String(answer || "").trim();
  let deadline = "";

  if (classification.kind === "success") {
    after.currentState = `Подтверждено: ${answerText}`;
    after.expectedEvent = "Закрыто";
    after.question = "—";
    after.options = [];
    after.controlDate = today(timezone);
    after.controlTime = "";
    after.controlStatus = "Выполнено";
    after.note = String(before.note || "").replace(/\s*AVIOR_META:[A-Za-z0-9_-]+/g, "").trim();
  } else if (classification.kind === "partial") {
    after.currentState = `Частичный результат: ${answerText}`;
    after.expectedEvent = "Уточнение частичного результата";
    after.question = "Что именно и в каком количестве получено?";
    after.options = [];
    after.controlStatus = "Ожидает уточнения";
    after.note = writeMeta(before.note, baseMeta);
  } else if (classification.kind === "pending") {
    after.currentState = `Не выполнено: ${answerText}`;
    after.expectedEvent = "Назначение срока контроля";
    after.question = "Когда проверить снова?";
    after.options = ["Сегодня", "Завтра", "Срок неизвестен", "Другая дата"];
    after.controlDate = "";
    after.controlTime = "";
    after.controlStatus = "Ожидается срок";
    after.note = writeMeta(before.note, baseMeta);
  } else if (classification.kind === "date" || classification.kind === "date_absolute") {
    const controlDate =
      classification.kind === "date_absolute"
        ? classification.value
        : today(timezone, classification.offsetDays);
    after.currentState = `${before.currentState}; следующий контроль ${controlDate}`;
    after.expectedEvent = "Назначение времени контроля";
    after.question =
      classification.kind === "date_absolute"
        ? `Во сколько ${controlDate} проверить?`
        : `Во сколько ${classification.offsetDays ? "завтра" : "сегодня"} проверить?`;
    after.options = ["10:00", "12:00", "15:00", "Другое время"];
    after.controlDate = controlDate;
    after.controlTime = "";
    after.controlStatus = "Ожидается время контроля";
    after.note = writeMeta(before.note, baseMeta);
    deadline = controlDate;
  } else if (classification.kind === "time") {
    const meta = readMeta(before.note);
    after.currentState = `${before.currentState}; контроль в ${classification.value}`;
    after.expectedEvent = "Контроль результата";
    after.question = meta.baseQuestion || "Результат уже получен?";
    after.options = meta.baseOptions?.length
      ? meta.baseOptions
      : ["Да, выполнено", "Выполнено частично", "Нет, ждём", "Есть проблема"];
    after.controlDate = before.controlDate || today(timezone);
    after.controlTime = classification.value;
    after.controlStatus = "Контроль назначен";
    after.note = writeMeta(before.note, meta.baseQuestion ? meta : baseMeta);
    deadline = `${after.controlDate} ${classification.value}`;
  } else if (classification.kind === "unknown_date") {
    after.currentState = `${before.currentState}; срок неизвестен`;
    after.expectedEvent = "Уточнение срока";
    after.question = baseMeta.baseQuestion || before.question;
    after.options = baseMeta.baseOptions?.length ? baseMeta.baseOptions : before.options;
    after.controlDate = "";
    after.controlTime = "";
    after.controlStatus = "Срок неизвестен";
    after.note = writeMeta(before.note, baseMeta);
  } else if (classification.kind === "issue") {
    after.currentState = `Зафиксирована проблема: ${answerText}`;
    after.expectedEvent = "Описание проблемы";
    after.question = "Кратко опишите проблему и требуемое действие";
    after.options = [];
    after.controlStatus = "Требуется решение";
    after.note = writeMeta(before.note, baseMeta);
  } else {
    after.currentState = `${before.currentState}; уточнение: ${answerText}`;
    after.expectedEvent = "Назначение следующего контроля";
    after.question = "Когда проверить следующий результат?";
    after.options = ["Сегодня", "Завтра", "Срок неизвестен", "Другая дата"];
    after.controlStatus = "Ожидается срок";
    after.note = writeMeta(before.note, baseMeta);
  }
  return { after, deadline };
}

export async function openWorkflow(store, timezone, requestedId = "", force = false) {
  return buildDashboard(await store.readState(force), timezone, requestedId);
}

export async function applyWorkflowAnswer(store, args, timezone) {
  const state = await store.readState();
  const before = selectNextWorkflow(state.workflows, timezone, args.workflow_id || "");
  if (!before) {
    return { ...buildDashboard(state, timezone), message: "Открытых вопросов нет." };
  }
  if (args.expected_event_id && before.lastEvent !== args.expected_event_id) {
    const error = new Error("Состояние изменилось после показа карточки. Нажмите «Обновить». ");
    error.code = "CONFLICT";
    throw error;
  }

  const answer = String(args.free_text || args.answer || "").trim();
  if (!answer) throw new Error("Выберите вариант или введите ответ.");
  const classification = classify(args.answer || answer, args.free_text || "");
  if (classification.kind === "requires_ai") {
    return {
      ...buildDashboard(state, timezone, before.workflowId),
      requiresAi: true,
      followUpMessage: `Прямая команда пользователя: ${answer}. Выполни её только для ${before.workflowId}; Gmail не проверяй шире этого запроса.`
    };
  }

  const { after, deadline } = applyTransition(before, classification, answer, timezone);
  const eventId = nextSequence(state.events, before.invoiceNo, yearInTimezone(timezone));
  after.lastEvent = eventId;
  const eventType = eventTypeFor(classification.kind, before.question);
  const eventRow = buildEventRow({ eventId, before, after, eventType, answer, timezone, deadline });
  await store.applyTransaction({ before, after, eventRow });
  const refreshed = {
    workflows: state.workflows.map((workflow) =>
      workflow.workflowId === after.workflowId ? cloneWorkflow(after) : workflow
    ),
    events: [...state.events, mapEventRow(eventRow, state.events.length + 2)]
  };
  return {
    ...buildDashboard(refreshed, timezone),
    transactionId: eventId,
    message: `Зафиксировано: ${answer}`
  };
}

function parseTx(comment) {
  const match = String(comment || "").match(/AVIOR_TX:([A-Za-z0-9_-]+)/);
  if (!match) return null;
  try {
    return decode(match[1]);
  } catch {
    return null;
  }
}

function parseUndo(comment) {
  const match = String(comment || "").match(/AVIOR_UNDO:([A-Za-z0-9_-]+)/);
  if (!match) return null;
  try {
    return decode(match[1]);
  } catch {
    return null;
  }
}

export async function undoLastTransaction(store, timezone) {
  const state = await store.readState();
  const undone = new Set(state.events.map((event) => parseUndo(event.comment)?.undoneEventId).filter(Boolean));
  const candidate = [...state.events]
    .reverse()
    .map((event) => ({ event, tx: parseTx(event.comment) }))
    .find(({ event, tx }) => tx?.kind === "transaction" && !undone.has(event.eventId));
  if (!candidate) throw new Error("Нет транзакции плагина, которую можно отменить.");

  const current = state.workflows.find((workflow) => workflow.workflowId === candidate.tx.workflowId);
  if (!current) throw new Error(`Workflow ${candidate.tx.workflowId} не найден.`);
  if (current.lastEvent !== candidate.event.eventId) {
    const error = new Error("После этой транзакции строка уже менялась. Автоматическая отмена заблокирована.");
    error.code = "CONFLICT";
    throw error;
  }

  const restored = {
    ...current,
    ...(() => {
      const row = candidate.tx.beforeRow;
      return {
        workflowId: row[0],
        orderId: row[1],
        invoiceNo: row[2],
        positionId: row[3],
        currentState: row[4],
        expectedEvent: row[5],
        question: row[6],
        options: row.slice(7, 11).filter(Boolean),
        controlDate: row[11],
        controlTime: row[12],
        controlStatus: row[13],
        lastEvent: row[14],
        note: row[15]
      };
    })()
  };
  const undoEventId = nextSequence(state.events, current.invoiceNo, yearInTimezone(timezone));
  restored.lastEvent = undoEventId;
  const undoMeta = { kind: "undo", undoneEventId: candidate.event.eventId, workflowId: current.workflowId };
  const undoRow = [
    undoEventId,
    displayDateTime(new Date(), timezone),
    current.orderId,
    current.invoiceNo,
    current.positionId,
    "TRANSACTION_UNDONE",
    "",
    "",
    "",
    "",
    "Плагин АВИОР",
    "Кнопка отмены",
    "Подтверждено пользователем",
    current.currentState,
    restored.currentState,
    restored.expectedEvent,
    restored.controlDate && restored.controlTime
      ? `${restored.controlDate} ${restored.controlTime}`
      : restored.controlDate,
    `Отменена транзакция ${candidate.event.eventId}. ${UNDO_PREFIX}${encode(undoMeta)}`
  ];
  await store.applyTransaction({ before: current, after: restored, eventRow: undoRow });
  const refreshed = {
    workflows: state.workflows.map((workflow) =>
      workflow.workflowId === restored.workflowId ? cloneWorkflow(restored) : workflow
    ),
    events: [...state.events, mapEventRow(undoRow, state.events.length + 2)]
  };
  return {
    ...buildDashboard(refreshed, timezone, restored.workflowId),
    transactionId: undoEventId,
    message: `Отменено действие ${candidate.event.eventId}`
  };
}

export const internals = {
  classify,
  applyTransition,
  dateKey,
  isClosed,
  readMeta
};
