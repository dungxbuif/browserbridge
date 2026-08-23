export const PROTOCOL_VERSION = 1;

export const defaultConfig = {
  serverUrl: "ws://127.0.0.1:8788/v1/extension",
  authToken: "",
  controlEnabled: false,
};

export const capabilities = ["browser.capabilities", "browser.status", "tabs.list", "tabs.open", "tabs.close", "runtime.evaluate", "media.uploadToDrive"];
