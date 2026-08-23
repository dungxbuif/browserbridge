import { MezonClient } from "mezon-sdk";
import {
  buttonEventID,
  handleButtonClick,
  handleChannelMessage,
  isMessageFromBot,
  messageEventID,
  sendNextMedia as sendNextMediaCore,
} from "./bot-core.js";
import { loadConfig } from "./config.js";
import { acquireSingleHostLock } from "./lock.js";
import { textMessage } from "./message.js";
import { createGuardedRunner } from "./scheduler.js";
import { MediaStore } from "./store.js";

const cfg = loadConfig();
const lock = cfg.singleHostLock ? await acquireSingleHostLock(cfg.lockFile) : null;
const store = new MediaStore(cfg.databaseUrl);
await store.migrate();

const client = new MezonClient({
  botId: cfg.mezonBotId,
  token: cfg.mezonToken,
  host: cfg.mezonHost,
  port: cfg.mezonPort,
  useSSL: cfg.mezonUseSSL,
  timeout: cfg.mezonTimeoutMs,
});

client.onChannelMessage((message) => safeRun("channel message", async () => {
  if (isMessageFromBot(message, client)) return;
  if (!(await acquireEvent(messageEventID(message), "channel_message"))) return;
  await handleChannelMessage({
    message,
    cfg,
    store,
    sendNextMedia,
  });
}));

client.onMessageButtonClicked((event) => safeRun("button click", async () => {
  if (!(await acquireEvent(buttonEventID(event), "button_click"))) return;
  await handleButtonClick({ event, cfg, store, sendText });
}));

async function sendNextMedia(postedBy, channelId = cfg.channelId) {
  return sendNextMediaCore({
    cfg,
    store,
    sendMessage,
    postedBy,
    channelId,
    notifyWhenEmpty: postedBy !== "scheduler",
  });
}

async function sendText(channelId, text) {
  return sendMessage(channelId, textMessage(text));
}

async function sendMessage(channelId, content) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId);
  return channel.send(content);
}

await client.login();
console.log(`BrowserBridge media bot connected. channel=${cfg.channelId}`);

const runScheduledPost = createGuardedRunner(
  () => sendNextMedia("scheduler"),
  {
    onError(error) {
      console.error("scheduled post failed", error);
    },
  },
);
const scheduler = setInterval(() => {
  void runScheduledPost();
}, cfg.postIntervalSeconds * 1000);

async function acquireEvent(eventId, eventType) {
  if (!eventId) return true;
  try {
    return await store.tryAcquireEvent({ eventId, eventType, ttlSeconds: cfg.dedupTTLSeconds });
  } catch (error) {
    console.error(`dedup ${eventType} failed`, error);
    return true;
  }
}

async function safeRun(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`bot ${label} failed`, error);
  }
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(scheduler);
  try {
    await store.close();
    await lock?.release();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
