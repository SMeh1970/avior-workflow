import { spawn } from "node:child_process";

const port = 18787;
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port), AVIOR_STORAGE: "memory" },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Сервер не запустился")), 5000);
    const onData = (chunk) => {
      if (!String(chunk).includes("АВИОР Workflow")) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`Сервер завершился: ${code}`)));
  });
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  const opened = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "open_avior_workflow", arguments: {} }
    })
  }).then((response) => response.json());
  if (health.status !== "ok" || opened.result.structuredContent.openCount !== 2) {
    throw new Error("Smoke test failed");
  }
  console.log("Smoke test passed");
} finally {
  child.kill("SIGTERM");
}
