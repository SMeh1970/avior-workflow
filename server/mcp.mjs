import { applyWorkflowAnswer, openWorkflow, undoLastTransaction } from "./engine.mjs";

export const WIDGET_URI = "ui://widget/avior-workflow.html";
const PROTOCOL_VERSION = "2025-06-18";

function widgetMeta() {
  return {
    "ui.resourceUri": WIDGET_URI,
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true
  };
}

function toolResult(data, text) {
  return {
    content: [{ type: "text", text: text || data.message || "АВИОР Workflow обновлён." }],
    structuredContent: data,
    _meta: widgetMeta()
  };
}

function toolsList() {
  return [
    {
      name: "open_avior_workflow",
      title: "Открыть АВИОР Workflow",
      description: "Открывает текущий вопрос и очередь Workflow V2 без Gmail.",
      inputSchema: {
        type: "object",
        properties: {
          workflow_id: { type: "string", description: "Необязательный ID строки Workflow V2." }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: widgetMeta()
    },
    {
      name: "apply_avior_answer",
      title: "Зафиксировать ответ АВИОР",
      description:
        "Фиксирует один подтверждённый ответ: добавляет событие и точечно обновляет связанную строку Workflow V2.",
      inputSchema: {
        type: "object",
        required: ["workflow_id", "answer"],
        properties: {
          workflow_id: { type: "string" },
          answer: { type: "string" },
          free_text: { type: "string" },
          expected_event_id: {
            type: "string",
            description: "Последнее событие, показанное в карточке; защищает от устаревшего ответа."
          }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: widgetMeta()
    },
    {
      name: "refresh_avior_state",
      title: "Обновить состояние АВИОР",
      description: "Полностью перечитывает Workflow V2 и События V2 только по прямой команде.",
      inputSchema: {
        type: "object",
        properties: { workflow_id: { type: "string" } },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: widgetMeta()
    },
    {
      name: "undo_avior_transaction",
      title: "Отменить последнее действие АВИОР",
      description: "Создаёт компенсирующее событие и восстанавливает предыдущую строку Workflow V2.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: widgetMeta()
    }
  ];
}

export function createMcpHandler({ store, config, widgetHtmlText = "<p>АВИОР Workflow</p>" }) {
  const widgetHtml = () => Promise.resolve(widgetHtmlText);

  async function callTool(name, args = {}) {
    if (name === "open_avior_workflow" || name === "refresh_avior_state") {
      const dashboard = await openWorkflow(
        store,
        config.timezone,
        args.workflow_id || "",
        name === "refresh_avior_state"
      );
      return toolResult(
        dashboard,
        dashboard.current
          ? name === "refresh_avior_state"
            ? "Состояние карточки АВИОР обновлено."
            : "Интерактивная карточка АВИОР открыта."
          : "Открытых вопросов нет."
      );
    }
    if (name === "apply_avior_answer") {
      try {
        const dashboard = await applyWorkflowAnswer(store, args, config.timezone);
        return toolResult(dashboard);
      } catch (error) {
        if (error.code !== "CONFLICT") throw error;
        const dashboard = await openWorkflow(store, config.timezone, args.workflow_id || "", true);
        return toolResult(
          {
            ...dashboard,
            message: "Карточка изменилась и автоматически обновлена. Ответ не записан — выберите его ещё раз."
          },
          "Устаревшая карточка автоматически обновлена."
        );
      }
    }
    if (name === "undo_avior_transaction") {
      return toolResult(await undoLastTransaction(store, config.timezone));
    }
    const error = new Error(`Неизвестный инструмент: ${name}`);
    error.code = "METHOD_NOT_FOUND";
    throw error;
  }

  return async function handleMcp(message) {
    const { id, method, params = {} } = message || {};
    try {
      let result;
      if (method === "initialize") {
        result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: "avior-workflow", version: "0.2.2" },
          instructions:
            "Операционный контроль АВИОР. Gmail никогда не проверяется автоматически. Для обычных кнопок используйте прямые tools/call."
        };
      } else if (method === "ping") {
        result = {};
      } else if (method === "tools/list") {
        result = { tools: toolsList() };
      } else if (method === "tools/call") {
        result = await callTool(params.name, params.arguments || {});
      } else if (method === "resources/list") {
        result = {
          resources: [
            {
              uri: WIDGET_URI,
              name: "АВИОР Workflow",
              description: "Интерактивная очередь и быстрые кнопки АВИОР.",
              mimeType: "text/html;profile=mcp-app"
            }
          ]
        };
      } else if (method === "resources/read") {
        if (params.uri !== WIDGET_URI) throw new Error(`Ресурс не найден: ${params.uri}`);
        result = {
          contents: [
            {
              uri: WIDGET_URI,
              mimeType: "text/html;profile=mcp-app",
              text: await widgetHtml(),
              _meta: {
                "openai/widgetPrefersBorder": true,
                "openai/widgetDescription": "Текущий вопрос АВИОР и варианты ответа"
              }
            }
          ]
        };
      } else if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
        return null;
      } else {
        const error = new Error(`Метод не поддерживается: ${method}`);
        error.code = "METHOD_NOT_FOUND";
        throw error;
      }
      if (id === undefined || id === null) return null;
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      if (id === undefined || id === null) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: error.code === "METHOD_NOT_FOUND" ? -32601 : error.code === "CONFLICT" ? -32009 : -32000,
          message: error.message || "Ошибка АВИОР Workflow",
          data: { code: error.code || "AVIOR_WORKFLOW" }
        }
      };
    }
  };
}
