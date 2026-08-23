import { defaultConfig } from "./protocol.js";

const form = document.querySelector("#config-form");
const serverUrl = document.querySelector("#server-url");
const authToken = document.querySelector("#auth-token");
const enabled = document.querySelector("#enabled");
const status = document.querySelector("#status");

void load();
form.addEventListener("submit", (event) => { event.preventDefault(); void save(); });

async function load() {
  const config = { ...defaultConfig, ...(await chrome.storage.local.get(defaultConfig)) };
  serverUrl.value = config.serverUrl;
  authToken.value = config.authToken;
  enabled.checked = config.controlEnabled;
}

async function save() {
  await chrome.storage.local.set({ serverUrl: serverUrl.value.trim(), authToken: authToken.value.trim(), controlEnabled: enabled.checked });
  await chrome.runtime.sendMessage({ type: "reconnect" });
  status.textContent = "Saved. The extension is reconnecting.";
}
