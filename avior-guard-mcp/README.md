# AVIOR Guard MCP — этап реального подключения

Сервис вынесен в отдельную ветку `avior-guard-mcp-pilot` репозитория `avior-workflow`. Рабочий `main` не изменён.

**Текущий код — безопасный диагностический MCP, а не уже подключённый Google-шлюз.** Он никогда не сообщает об успешной записи и не меняет Gmail / Google Sheets.

## Что реально сделано
- Создан MCP endpoint Streamable HTTP `/mcp`.
- Добавлен `avior_guard_status` для теста подключения ChatGPT.
- Добавлен `avior_validate_transaction_shape` с fail-closed поведением: даже допустимая по форме команда не получает разрешение без доверенной проверки оригинала Google.

## Развёртывание
Render: runtime Python, repo `https://github.com/SMeh1970/avior-workflow`, branch `avior-guard-mcp-pilot`, plan `free`, region Frankfurt, build `pip install -r avior-guard-mcp/requirements.txt`, start `python avior-guard-mcp/server.py`.

На 13.10.2026 создание бесплатного сервиса Render блокируется HTTP 402 Payment information required. Никаких платных ресурсов не создано.

После развёртывания: Plugins → + → Add custom MCP server → указать `https://<service>.onrender.com/mcp`, затем установить плагин и вызвать `avior_guard_status`.

## Что потребуется для доступа к Google
1. Google API авторизация для отдельного аккаунта с доступом только к тестовой копии заявки 5799.
2. Защищённая авторизация самого MCP (OAuth 2.1): не давать неавторизованному публичному MCP ни чтение, ни запись в приватные документы.
3. Серверная проверка: извлекать данные оригинала самим сервером, сравнивать и записывать только разрешённую ячейку тестовой копии, затем сверять readback.
4. Испытать запреты на ошибочные цены, структурные изменения, ложные статусы `готово`.
5. Только потом ограничивать прямые пути записи и рассматривать рабочее подключение.

Не добавляйте Google токены, service account JSON или реквизиты организации в GitHub, файлы промптов и публичный MCP. 
