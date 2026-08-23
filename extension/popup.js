const toggle = document.querySelector("#toggle");
const connection = document.querySelector("#connection");

void refresh();
toggle.addEventListener("click", () => void toggleControl());

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: "status" });
  connection.textContent = status.connected ? "Connected" : status.enabled ? "Connecting…" : "Control is off";
  toggle.textContent = status.enabled ? "Turn control off" : "Turn control on";
}

async function toggleControl() {
  await chrome.runtime.sendMessage({ type: "set-enabled" });
  await refresh();
}
