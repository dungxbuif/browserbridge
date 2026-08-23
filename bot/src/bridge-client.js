export class BrowserBridgeClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.token = token;
  }

  async openTab(url, { active = false } = {}) {
    return this.request("/v1/tabs", {
      method: "POST",
      body: { url, active },
    });
  }

  async listTabs() {
    return this.request("/v1/tabs");
  }

  async closeTab(tabId) {
    return this.request(`/v1/tabs/${encodeURIComponent(tabId)}`, {
      method: "DELETE",
    });
  }

  async evaluate({ tabId, expression, world = "MAIN" }) {
    return this.request("/v1/runtime/evaluate", {
      method: "POST",
      body: { tab_id: tabId, expression, world },
    });
  }

  async uploadMedia(payload) {
    return this.request("/v1/media/transfers", {
      method: "POST",
      body: payload,
      timeoutMs: 2 * 60 * 60 * 1000,
    });
  }

  async request(path, { method = "GET", body, timeoutMs = 120000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        throw new Error(`BrowserBridge ${method} ${path} failed: HTTP ${response.status} ${await response.text()}`);
      }
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
