import assert from "node:assert/strict";
import test from "node:test";

import { loadBotConfig, loadWorkerConfig } from "../src/config.js";

test("loadBotConfig requires Mezon bot id with token/channel/admin", () => {
  const snapshot = { ...process.env };
  try {
    process.env.DATABASE_URL = "postgres://example";
    delete process.env.MEZON_BOT_ID;
    process.env.MEZON_BOT_TOKEN = "token";
    process.env.MEZON_CHANNEL_ID = "channel";
    process.env.MEZON_ADMIN_USER_ID = "admin";
    process.env.BROWSER_BRIDGE_AUTH_TOKEN = "bridge-token";
    assert.throws(() => loadBotConfig(), /MEZON_BOT_ID/);

    process.env.MEZON_BOT_ID = "bot-id";
    const cfg = loadBotConfig();
    assert.equal(cfg.mezonBotId, "bot-id");
    assert.equal(cfg.mezonToken, "token");
    assert.equal(cfg.mezonHost, "gw.mezon.ai");
    assert.equal(cfg.mezonPort, "443");
    assert.equal(cfg.mezonUseSSL, true);
    assert.equal(cfg.mezonTimeoutMs, 10000);
    assert.equal(cfg.singleHostLock, true);
    assert.match(cfg.lockFile, /bot\/browserbridge-mezon-bot\.lock$/);
    assert.equal(cfg.dedupTTLSeconds, 86400);
    assert.equal(cfg.mediaClaimTTLSeconds, 300);

    process.env.MEZON_HOST = "custom.mezon.test";
    process.env.MEZON_PORT = "8443";
    process.env.MEZON_USE_SSL = "false";
    process.env.MEZON_TIMEOUT_MS = "5000";
    process.env.BOT_SINGLE_HOST_LOCK = "false";
    process.env.BOT_LOCK_FILE = "/tmp/browserbridge-test.lock";
    const custom = loadBotConfig();
    assert.equal(custom.mezonHost, "custom.mezon.test");
    assert.equal(custom.mezonPort, "8443");
    assert.equal(custom.mezonUseSSL, false);
    assert.equal(custom.mezonTimeoutMs, 5000);
    assert.equal(custom.singleHostLock, false);
    assert.equal(custom.lockFile, "/tmp/browserbridge-test.lock");

    process.env.MEZON_USE_SSL = "flase";
    assert.throws(() => loadBotConfig(), /MEZON_USE_SSL/);

    process.env.MEZON_USE_SSL = "true";
    process.env.BOT_SINGLE_HOST_LOCK = "sometimes";
    assert.throws(() => loadBotConfig(), /BOT_SINGLE_HOST_LOCK/);

    process.env.BOT_SINGLE_HOST_LOCK = "false";
    process.env.BOT_DEDUP_TTL_SECONDS = "60";
    assert.equal(loadBotConfig().dedupTTLSeconds, 60);
    process.env.BOT_MEDIA_CLAIM_TTL_SECONDS = "120";
    assert.equal(loadBotConfig().mediaClaimTTLSeconds, 120);

    process.env.BOT_DEDUP_TTL_SECONDS = "0";
    assert.throws(() => loadBotConfig(), /BOT_DEDUP_TTL_SECONDS/);

    process.env.BOT_DEDUP_TTL_SECONDS = "60";
    process.env.BOT_MEDIA_CLAIM_TTL_SECONDS = "0";
    assert.throws(() => loadBotConfig(), /BOT_MEDIA_CLAIM_TTL_SECONDS/);

    process.env.BOT_MEDIA_CLAIM_TTL_SECONDS = "120";
    process.env.MEZON_PORT = "70000";
    assert.throws(() => loadBotConfig(), /MEZON_PORT/);

    process.env.SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS = "900";
    const workerCfg = loadWorkerConfig();
    assert.equal(workerCfg.userClaimTTLSeconds, 900);
    assert.equal(workerCfg.platform, "tiktok");
    process.env.SOCIAL_MEDIA_PLATFORM = "ALL";
    assert.equal(loadWorkerConfig().platform, "all");
    process.env.SOCIAL_MEDIA_PLATFORM = "youtube";
    assert.throws(() => loadWorkerConfig(), /SOCIAL_MEDIA_PLATFORM/);
    process.env.SOCIAL_MEDIA_PLATFORM = "tiktok";
    process.env.SOCIAL_MEDIA_WORKER_RUN_ONCE = "maybe";
    assert.throws(() => loadWorkerConfig(), /SOCIAL_MEDIA_WORKER_RUN_ONCE/);
    process.env.SOCIAL_MEDIA_WORKER_RUN_ONCE = "true";
    assert.equal(loadWorkerConfig().runOnce, true);
    process.env.SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS = "0";
    assert.throws(() => loadWorkerConfig(), /SOCIAL_MEDIA_USER_CLAIM_TTL_SECONDS/);
  } finally {
    process.env = snapshot;
  }
});
