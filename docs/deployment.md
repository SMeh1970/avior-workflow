# Подключение живого реестра

## 1. Google

1. Создайте служебную учётную запись в отдельном Google Cloud project.
2. Включите Google Sheets API.
3. Создайте JSON-ключ служебной учётной записи.
4. Поделитесь только таблицей «Реестр контроля АВИОР» с email служебной учётной записи, доступ `Редактор`.
5. Преобразуйте JSON в Base64 и сохраните результат только как секрет `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` в Cloudflare. Не отправляйте ключ в чат и не добавляйте его в Git.

## 2. Cloudflare Workers Free

1. В Cloudflare откройте `Workers & Pages → Create application`.
2. Возле `Import a repository` нажмите `Get started`.
3. Подключите GitHub и выберите `SMeh1970/avior-workflow`.
4. Имя Worker должно быть строго `avior-workflow`; ветка — `main`.
5. Build command оставьте пустой, Deploy command — `npx wrangler deploy`.
6. Нажмите `Save and Deploy`.
7. Откройте Worker → `Settings → Variables and Secrets → Add`.
8. Имя секрета: `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`. Значение — Base64 из JSON-ключа Google. Тип — `Secret`.
9. Нажмите `Deploy` и проверьте `https://avior-workflow.<account>.workers.dev/health`.
10. MCP URL будет `https://avior-workflow.<account>.workers.dev/mcp`.

Workers Builds использует Wrangler `4.125.0` из `package.json`; последующие коммиты в `main` развёртываются автоматически.

## 3. ChatGPT Work

1. Откройте `Настройки → Безопасность и вход` и включите режим разработчика.
2. В разделе Plugins добавьте MCP URL с окончанием `/mcp`.
3. Откройте созданное подключение и скопируйте технический ID `plugin_asdk_app_...`.
4. Добавьте этот ID в `.app.json` при финальной упаковке плагина или используйте MCP-подключение напрямую в личном Workflow.

## Безопасность

- Плагин не содержит Gmail-инструментов.
- Доступ служебной учётной записи ограничивается одной таблицей.
- Каждая запись содержит подтверждение пользователя и журналируемый ID транзакции.
- Секреты читаются только из переменных окружения.
- Worker работает на бесплатном тарифе Cloudflare без платёжной карты и без ожидания холодного запуска Render.
