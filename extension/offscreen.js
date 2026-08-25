import { capabilities, defaultConfig, PROTOCOL_VERSION } from "./protocol.js";

let socket;
let heartbeatTimer;
let reconnectAttempt = 0;
let reconnectTimer;
let currentConfig = null;

// Offscreen document: owns the WebSocket transport so it survives service
// worker lifecycle. It must NOT use chrome.storage here; config is passed in
// from the background worker with each connect message.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (message.bridge === "connect") {
    currentConfig = message.config || null;
    void connectIfNeeded();
    sendResponse({ ok: true });
    return true;
  }
  if (message.bridge === "send") {
    if (socket?.readyState === WebSocket.OPEN) socket.send(message.raw);
    sendResponse({ ok: true });
    return true;
  }
  if (message.bridge === "status") {
    sendResponse({ connected: socket?.readyState === WebSocket.OPEN });
    return true;
  }
  return false;
});

function postToServer(raw) {
  void chrome.runtime.sendMessage({ target: "bridge-message", raw }).catch(() => {});
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function connectIfNeeded() {
  const config = currentConfig || defaultConfig;
  if (!config.controlEnabled || !config.authToken || !config.serverUrl) {
    stopHeartbeat();
    return;
  }
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  clearReconnectTimer();
  let ws;
  try {
    ws = new WebSocket(config.serverUrl);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    reconnectAttempt = 0;
    send({ v: PROTOCOL_VERSION, type: "hello", token: config.authToken, capabilities, enabled: true });
    startHeartbeat();
  };
  ws.onmessage = (event) => postToServer(event.data);
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    stopHeartbeat();
    if (socket === ws) {
      socket = null;
      scheduleReconnect();
    }
  };
}

function scheduleReconnect() {
  clearReconnectTimer();
  const base = Math.min(30_000, 500 * 2 ** (reconnectAttempt++));
  reconnectTimer = setTimeout(() => void connectIfNeeded(), base + Math.floor(Math.random() * 250));
}

function clearReconnectTimer() {
  if (reconnectTimer !== undefined) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "ping" }));
    // Chrome closes an offscreen document after ~30s with no runtime API
    // activity. Touching chrome.runtime keeps the document (and its WebSocket) alive.
    try {
      void chrome.runtime.sendMessage({ bridge: "keepalive" }).catch(() => {});
    } catch {
      // keepalive is best-effort
    }
  }, 10_000);
}

function stopHeartbeat() {
  if (heartbeatTimer !== undefined) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}