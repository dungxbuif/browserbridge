import { capabilities, defaultConfig, PROTOCOL_VERSION } from "./protocol.js";

const DIRECT_CHUNK_SIZE = 4 * 1024 * 1024;
const MAIN_WORLD_CHUNK_SIZE = 1024 * 1024;

chrome.runtime.onInstalled.addListener(() => void bootstrapBridge());
chrome.runtime.onStartup.addListener(() => void bootstrapBridge());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  // Messages relayed from the offscreen WebSocket transport.
  if (message.target === "bridge-message") {
    void handleServerMessage(message.raw).then(sendResponse, sendResponse);
    return true;
  }

  // Messages from the popup.
  if (message.type === "status") {
    void getStatus().then(sendResponse);
    return true;
  }
  if (message.type === "reconnect") {
    void reconnectNow().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "set-enabled") {
    void toggleEnabled().then(sendResponse);
    return true;
  }
  // Heartbeat from the offscreen transport; acknowledge without waking work.
  if (message.bridge === "keepalive") {
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "keep the Browser Bridge WebSocket alive across service worker lifecycle",
    });
  } catch {
    // already exists or not supported; fall through
  }
}

async function bootstrapBridge() {
  try {
    await ensureOffscreen();
    await reconnectNow();
  } catch {
    // non-fatal; popup "reconnect" will retry
  }
}

async function reconnectNow() {
  const config = await getConfig();
  try {
    await chrome.runtime.sendMessage({ bridge: "connect", config });
  } catch {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ bridge: "connect", config });
  }
}

async function getConfig() {
  const stored = await chrome.storage.local.get(defaultConfig);
  const config = { ...defaultConfig, ...stored };
  if (!config.authToken) config.authToken = defaultConfig.authToken;
  return config;
}

async function getStatus() {
  const config = await getConfig();
  let connected = false;
  try {
    const r = await chrome.runtime.sendMessage({ bridge: "status" });
    connected = Boolean(r?.connected);
  } catch {
    // no offscreen doc yet
  }
  return { enabled: config.controlEnabled, connected, serverUrl: config.serverUrl };
}

async function toggleEnabled() {
  const config = await getConfig();
  const enabled = !config.controlEnabled;
  await chrome.storage.local.set({ controlEnabled: enabled });
  if (enabled) await reconnectNow();
  return getStatus();
}

async function handleServerMessage(raw) {
  if (typeof raw !== "string") return;
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message.v !== PROTOCOL_VERSION) return;
  if (message.type === "ping") {
    await sendToBridge({ v: PROTOCOL_VERSION, type: "pong" });
    return;
  }
  if (message.type !== "command" || !message.id || !message.method) return;
  const config = await getConfig();
  if (!config.controlEnabled) {
    await sendError(message.id, "CONTROL_DISABLED", "Browser control is disabled", false);
    return;
  }
  if (message.deadline_at && Date.parse(message.deadline_at) < Date.now()) {
    await sendError(message.id, "DEADLINE_EXCEEDED", "Command deadline has passed", false);
    return;
  }
  try {
    const result = await execute(message.method, message.params ?? {});
    await sendTo({ v: PROTOCOL_VERSION, type: "result", id: message.id, result });
  } catch (error) {
    await sendError(message.id, "CHROME_ERROR", error instanceof Error ? error.message : "Chrome command failed", false);
  }
}

async function sendTo(message) {
  await chrome.runtime.sendMessage({ bridge: "send", raw: JSON.stringify(message) });
}

async function sendError(id, code, messageText, retryable) {
  await sendTo({ v: PROTOCOL_VERSION, type: "error", id, error: { code, message: messageText, retryable } });
}

async function execute(method, params) {
  if (method === "browser.capabilities") return { capabilities };
  if (method === "browser.status") return getStatus();
  if (method === "tabs.list") {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({ id: tab.id, window_id: tab.windowId, title: tab.title ?? "", url: tab.url ?? "", active: Boolean(tab.active) }));
  }
  if (method === "tabs.open") {
    const url = requireString(params.url, "url");
    const tab = await chrome.tabs.create({ url, active: params.active !== false });
    return { id: tab.id, window_id: tab.windowId, title: tab.title ?? "", url: tab.url ?? url, active: Boolean(tab.active) };
  }
  if (method === "tabs.close") {
    const tabId = await resolveTabId(params.tab_id);
    await chrome.tabs.remove(tabId);
    return { ok: true, id: tabId };
  }
  if (method === "runtime.evaluate") {
    const expression = requireString(params.expression, "expression");
    const tabId = await resolveTabId(params.tab_id);
    const world = params.world === "MAIN" ? "MAIN" : "ISOLATED";
    return executeExpression(tabId, expression, world);
  }
  if (method === "media.uploadToDrive") return uploadMediaToDrive(params);
  throw new Error(`UNSUPPORTED_METHOD: ${method}`);
}

async function uploadMediaToDrive(params) {
  const mediaUrl = requireString(params.media_url, "media_url");
  const filename = requireString(params.filename, "filename");
  const config = await getConfig();
  const backendBase = backendBaseUrl(config.serverUrl);
  const common = {
    backendBase,
    authToken: config.authToken,
    mediaUrl,
    filename,
    mimeType: params.mime_type || "application/octet-stream",
    driveFolderId: params.drive_folder_id || "",
    platform: params.platform || "",
    sourceUserId: params.source_user_id || "",
    sourceUsername: params.source_username || "",
    mediaId: params.media_id || "",
    postId: params.post_id || "",
    mediaType: params.media_type || "",
    previewUrl: params.preview_url || "",
    metadata: params.metadata || {},
  };

  try {
    return await uploadMediaByExtensionFetch(common);
  } catch (directError) {
    const tabId = await resolveTabId(params.tab_id);
    try {
      const result = await uploadMediaByMainWorldFetch({ ...common, tabId });
      result.fetch_mode = "main_world";
      result.direct_error = directError instanceof Error ? directError.message : "direct fetch failed";
      return result;
    } catch (fallbackError) {
      throw new Error(`media upload failed; direct=${directError instanceof Error ? directError.message : directError}; main_world=${fallbackError instanceof Error ? fallbackError.message : fallbackError}`);
    }
  }
}

async function uploadMediaByExtensionFetch(options) {
  const response = await fetch(options.mediaUrl, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(`media fetch failed with HTTP ${response.status}`);

  const totalSize = parseContentLength(response.headers.get("Content-Length"));
  if (!totalSize) return uploadMediaBlob(await response.blob(), options, "extension_blob");

  const mimeType = options.mimeType || response.headers.get("Content-Type") || "application/octet-stream";
  const session = await createUploadSession({ ...options, mimeType, totalSize });
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    await uploadChunk(options, session.id, bytes, 0, bytes.byteLength);
    return uploadDone(session.id, options, "extension_array_buffer");
  }

  const reader = response.body.getReader();
  let offset = 0;
  let buffer = new Uint8Array(0);
  for (;;) {
    const { value, done } = await reader.read();
    if (value?.byteLength) buffer = concatBytes(buffer, value);
    while (buffer.byteLength >= DIRECT_CHUNK_SIZE) {
      const chunk = buffer.slice(0, DIRECT_CHUNK_SIZE);
      await uploadChunk(options, session.id, chunk, offset, totalSize);
      offset += chunk.byteLength;
      buffer = buffer.slice(DIRECT_CHUNK_SIZE);
    }
    if (done) break;
  }
  if (buffer.byteLength > 0) {
    await uploadChunk(options, session.id, buffer, offset, totalSize);
  }
  return uploadDone(session.id, options, "extension_stream");
}

async function uploadMediaBlob(blob, options, fetchMode) {
  const totalSize = blob.size;
  if (!totalSize) throw new Error("media response is empty");
  const mimeType = options.mimeType || blob.type || "application/octet-stream";
  const session = await createUploadSession({ ...options, mimeType, totalSize });
  for (let offset = 0; offset < totalSize; offset += DIRECT_CHUNK_SIZE) {
    const slice = blob.slice(offset, Math.min(offset + DIRECT_CHUNK_SIZE, totalSize));
    await uploadChunk(options, session.id, new Uint8Array(await slice.arrayBuffer()), offset, totalSize);
  }
  return uploadDone(session.id, options, fetchMode);
}

async function uploadMediaByMainWorldFetch(options) {
  const handle = `__browserBridgeMedia_${crypto.randomUUID().replaceAll("-", "")}`;
  await executeInMainWorld(options.tabId, async (mediaUrl, handleName) => {
    const response = await fetch(mediaUrl, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`media fetch failed with HTTP ${response.status}`);
    globalThis[handleName] = await response.blob();
    return true;
  }, [options.mediaUrl, handle]);
  try {
    const meta = await executeInMainWorld(options.tabId, (handleName) => {
      const blob = globalThis[handleName];
      if (!blob) throw new Error("media blob handle is missing");
      return { size: blob.size, type: blob.type || "" };
    }, [handle]);
    const totalSize = meta.size;
    if (!totalSize) throw new Error("media response is empty");
    const mimeType = options.mimeType || meta.type || "application/octet-stream";
    const session = await createUploadSession({ ...options, mimeType, totalSize });
    for (let offset = 0; offset < totalSize; offset += MAIN_WORLD_CHUNK_SIZE) {
      const base64 = await executeInMainWorld(options.tabId, async (handleName, start, end) => {
        const blob = globalThis[handleName];
        if (!blob) throw new Error("media blob handle is missing");
        const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      }, [handle, offset, Math.min(offset + MAIN_WORLD_CHUNK_SIZE, totalSize)]);
      await uploadChunk(options, session.id, base64ToBytes(base64), offset, totalSize);
    }
    return uploadDone(session.id, options, "main_world");
  } finally {
    await executeInMainWorld(options.tabId, (handleName) => {
      delete globalThis[handleName];
      return true;
    }, [handle]).catch(() => undefined);
  }
}

async function createUploadSession(options) {
  const response = await fetch(`${options.backendBase}/v1/media/upload-sessions`, {
    method: "POST",
    headers: authJSONHeaders(options.authToken),
    body: JSON.stringify({
      filename: options.filename,
      mime_type: options.mimeType,
      drive_folder_id: options.driveFolderId,
      total_size: options.totalSize,
      media_url: options.mediaUrl,
      platform: options.platform,
      source_user_id: options.sourceUserId,
      source_username: options.sourceUsername,
      media_id: options.mediaId,
      post_id: options.postId,
      media_type: options.mediaType,
      preview_url: options.previewUrl,
      metadata: options.metadata,
    }),
  });
  if (!response.ok) throw new Error(`upload session create failed with HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function uploadChunk(options, sessionId, chunk, offset, totalSize) {
  const end = offset + chunk.byteLength - 1;
  const response = await fetch(`${options.backendBase}/v1/media/upload-sessions/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${options.authToken}`,
      "Content-Type": "application/octet-stream",
      "Content-Range": `bytes ${offset}-${end}/${totalSize}`,
    },
    body: chunk,
  });
  if (!response.ok) throw new Error(`chunk upload failed with HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function uploadDone(sessionId, options, fetchMode) {
  const response = await fetch(`${options.backendBase}/v1/media/upload-sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${options.authToken}` },
  });
  if (!response.ok) throw new Error(`upload status failed with HTTP ${response.status}: ${await response.text()}`);
  const status = await response.json();
  if (status.status !== "complete") throw new Error(`upload did not complete; next_offset=${status.next_offset ?? "unknown"}`);
  return { ...status, fetch_mode: fetchMode };
}

async function resolveTabId(tabId) {
  if (Number.isInteger(tabId) && tabId > 0) return tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("tab_id is required when no active tab is available");
  return tab.id;
}

async function executeInMainWorld(tabId, func, args) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  if (!result) throw new Error("script execution returned no result");
  if (result.error) throw new Error(result.error.message || "script execution failed");
  return result.result;
}

async function executeExpression(tabId, expression, world) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world,
    func: (source) => {
      return (0, eval)(source);
    },
    args: [expression],
  });
  if (!result) throw new Error("script execution returned no result");
  if (result.error) throw new Error(result.error.message || "script execution failed");
  return result.result;
}

function backendBaseUrl(serverUrl) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/v1\/extension\/?$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function authJSONHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

function parseContentLength(value) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function concatBytes(left, right) {
  const next = new Uint8Array(left.byteLength + right.byteLength);
  next.set(left, 0);
  next.set(right, left.byteLength);
  return next;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

void bootstrapBridge();