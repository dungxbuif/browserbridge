# Extension

Chrome Manifest V3 extension source, dùng JavaScript ES modules trực tiếp để có
thể load unpacked không cần Node/npm build tool.

Load chính thư mục `extension/` trong `chrome://extensions` (Developer mode).
Hiện có options/popup, shared-token configuration, auto-connect WSS, `tabs.list`,
`tabs.open`, `tabs.close`, `runtime.evaluate` và `media.uploadToDrive`.

Local config:

- WebSocket server URL: `ws://127.0.0.1:8788/v1/extension`
- Pairing token: giá trị `BROWSER_BRIDGE_AUTH_TOKEN` trong `server/.env`
- Enable browser control: on

Media upload flow:

1. Backend gửi command `media.uploadToDrive` qua WSS.
2. Service worker thử `fetch(media_url, { credentials: "include" })`.
3. Nếu bị chặn, extension dùng `chrome.scripting.executeScript` trong MAIN world của tab đích để fetch bằng session trang hiện tại.
4. Background upload raw chunks về backend; token Browser Bridge không được đưa vào page context.

Manifest cần `scripting`, `activeTab` và `<all_urls>` để fetch media/backend URL động trong trusted personal mode.
