import { BrowserBridgeClient } from "./bridge-client.js";
import { loadWorkerConfig } from "./config.js";
import { runConfiguredTick } from "./media-worker-core.js";
import { createGuardedRunner } from "./scheduler.js";
import { MediaStore } from "./store.js";

const cfg = loadWorkerConfig();
const store = new MediaStore(cfg.databaseUrl);
await store.migrate();

const bridge = new BrowserBridgeClient({
  baseUrl: cfg.bridgeHttpUrl,
  token: cfg.bridgeAuthToken,
});

const runTickGuarded = createGuardedRunner(
  () => runConfiguredTick({ cfg, store, bridge }),
  {
    onSkip() {
      console.log("media worker: previous tick is still running; skipping this interval");
    },
    onError(error) {
      console.error("media worker: scheduled tick failed", error);
    },
  },
);
await runTickGuarded();

if (cfg.runOnce) {
  await store.close();
  process.exit(0);
}

const interval = setInterval(() => {
  void runTickGuarded();
}, cfg.scanIntervalSeconds * 1000);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(interval);
  try {
    await store.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
