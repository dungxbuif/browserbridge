import { spawn } from "node:child_process";
import { createServer } from "node:http";

const token = "verify-secret-token";
const requests = [];
let port = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port || 0}`);
  requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization || "" });
  if (url.pathname === "/healthz") {
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/v1/status") {
    if (req.headers.authorization !== `Bearer ${token}`) {
      return json(res, 401, { error: "unauthorized" });
    }
    return json(res, 200, {
      extension_connected: false,
      drive_configured: true,
      drive_folder_set: true,
      media_store_set: true,
      active_uploads: 0,
    });
  }
  return json(res, 404, { error: "not found" });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  const result = await runReadiness();
  if (result.code !== 1) throw new Error(`expected readiness to fail while extension is disconnected, got ${result.code}`);
  if (result.stdout.includes(token) || result.stderr.includes(token)) {
    throw new Error("readiness output leaked auth token");
  }
  const finalReport = parseFinalReport(result.stdout);
  if (finalReport.ok !== false || finalReport.timedOut !== true) {
    throw new Error(`unexpected final readiness report ${JSON.stringify(finalReport)}`);
  }
  const report = finalReport.lastReport;
  if (report.env.BROWSER_BRIDGE_AUTH_TOKEN !== true) throw new Error("auth token presence was not reported as boolean true");
  if (report.browserBridge.healthOk !== true) throw new Error("fake bridge health was not detected");
  if (report.browserBridge.extensionConnected !== false) throw new Error("extension disconnected state was not reported");
  if (!report.hints.some((hint) => hint.includes("Open Chrome extension options"))) {
    throw new Error(`extension connection hint missing: ${JSON.stringify(report.hints)}`);
  }
  if (!requests.some((item) => item.path === "/v1/status" && item.authorization === `Bearer ${token}`)) {
    throw new Error("readiness verifier did not call authenticated status endpoint");
  }

  console.log(JSON.stringify({
    ok: true,
    exitCode: result.code,
    tokenLeaked: false,
    browserBridge: report.browserBridge,
    env: report.env,
    hints: report.hints,
    requests: requests.map((item) => item.path),
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function runReadiness() {
  const child = spawn("node", ["tools/wait_live_ready.mjs", "--wait-seconds", "1", "--interval-seconds", "1"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      BROWSER_BRIDGE_HTTP_URL: `http://127.0.0.1:${port}`,
      BROWSER_BRIDGE_AUTH_TOKEN: token,
      DATABASE_URL: "",
      MEZON_BOT_ID: "",
      MEZON_BOT_TOKEN: "",
      MEZON_CHANNEL_ID: "",
      MEZON_ADMIN_USER_ID: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolve) => child.on("close", resolve));
  return { code, stdout, stderr };
}

function parseFinalReport(stdout) {
  const marker = '{\n  "ok": false,\n  "timedOut": true,';
  const index = stdout.lastIndexOf(marker);
  if (index < 0) throw new Error(`final timeout report not found in output: ${stdout}`);
  return JSON.parse(stdout.slice(index));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
