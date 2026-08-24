# АВИОР Workflow

Личный MCP-плагин для быстрого операционного контроля ООО «АВИОР».

## Что делает

- один раз читает `Workflow V2` и показывает ближайший вопрос;
- кнопка напрямую вызывает MCP-инструмент без нового полноценного ответа модели;
- одной транзакцией добавляет событие в `События V2` и обновляет связанную строку `Workflow V2`;
- программно определяет следующий вопрос;
- не обращается к Gmail без прямой команды;
- вызывает ИИ только для свободного текста, скриншотов и неоднозначностей.

## Локальный запуск

```bash
node server/index.mjs
```

Откройте `http://localhost:8787/health`. MCP endpoint: `http://localhost:8787/mcp`.

По умолчанию используется безопасное демонстрационное хранилище в памяти. Для реального Google Sheet скопируйте `.env.example` в переменные окружения хостинга, установите `AVIOR_STORAGE=google` и добавьте секрет `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`.

## Cloudflare Workers

Версия `0.2.2` запускается на Cloudflare Workers Free и не засыпает после простоя.

```bash
npm install
npm run dev:worker
```

Конфигурация находится в `wrangler.jsonc`. Единственный секрет —
`GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`; JSON-ключ Google не хранится в репозитории.

## Проверка

```bash
npm test
npm run check
npm run deploy:dry
```

## Размещение

Основное размещение — Cloudflare Workers Builds из GitHub. Подробная последовательность подключения находится в `docs/deployment.md`. `render.yaml` сохранён только как запасной вариант.
