# Social Bulk Downloader Reverse Notes

## What This Is

- Chrome extension Manifest V3.
- Name: `Social Bulk Downloader`.
- Version: `1.8.4`.
- Author: `minhchi1509`.
- Built with Parcel/Plasmo-style bundles.
- Target sites: Bilibili, Douyin, Instagram, Kuaishou, Rednote, Threads, Facebook, TikTok, Weibo, X.

## Generated Artifacts

- `reverse-engineered/beautified/*.pretty.js`: rough pretty-printed bundle files.
- `reverse-engineered/reports/REPORT.md`: manifest, permissions, APIs, endpoints, message keys.
- `reverse-engineered/reports/index.json`: machine-readable extracted summary.

## Architecture

- `manifest.json` registers one isolated content script per social site.
- `static/background/index.js` is the MV3 service worker.
- `main-world-rednote.52d164fe.js` and `main-world-tiktok-douyin.9c891ac2.js` are registered into `MAIN` world from the background so they can access page globals/cookies and perform signed fetches.
- Messaging uses `@webext-core/messaging` with namespace `cnejldbhpclimaappoekdhmeieehfdpb`.

## Background Responsibilities

- Registers webRequest listeners to capture request credentials from real browser traffic.
- Stores credentials in `chrome.storage.local`.
- Handles content-script messages:
  - `getAccountCredentials`
  - `downloadMedia`
  - `downloadForbiddenMedia`
  - `getDouyinUiFid`
  - `getDownloadFileNameConfig`
- Uses `chrome.downloads.download`, monitors completion, and tries resume on interrupted downloads.
- Uses `chrome.declarativeNetRequest` to modify/remove headers for cross-origin media/API requests.

## Credential Capture

The service worker watches:

- `facebook.com/api/graphql`
- `instagram.com/graphql/query`
- `threads.com/graphql/query`
- `x.com/i/api/graphql`
- `tiktok.com/api`

Extracted credential examples:

- Facebook: `av`, `fb_dtsg`
- Instagram/Threads: `x-ig-app-id`, `x-csrftoken`, `fb_dtsg`
- X: `authorization`, `x-csrf-token`
- TikTok: `device_id`, `odinId`

Storage keys include:

- `FACEBOOK_REQUEST_CREDENTIALS`
- `INSTAGRAM_REQUEST_CREDENTIALS`
- `THREADS_REQUEST_CREDENTIALS`
- `X_REQUEST_CREDENTIALS`
- `TIKTOK_REQUEST_CREDENTIALS`
- `DOWNLOAD_SINGLE_FILE_NAME_CONFIG`

## Main-World Bridges

### TikTok/Douyin

`main-world-tiktok-douyin` listens for `callTiktokDouyinApi` and performs:

- `fetch(url, options)`
- returns JSON when response is OK

This lets isolated content scripts call APIs with page context.

### Rednote

`main-world-rednote` listens for `callRednoteApi`, signs requests, then calls:

- `https://webapi.rednote.com${uri}`

It builds Rednote headers:

- `x-s`
- `x-s-common`
- `x-t`

Signature generation depends on page globals such as `window.mnsv2`, `window.xsecplatform`, `window.xsecappvers`, localStorage values, and cookies.

## Download Flow

- Content script extracts post/profile/album media data.
- It chooses best media URL where possible.
- Filename is generated from configured fields such as `id`, `title`, `timestamp`, and numerical order.
- Normal files are downloaded via background `downloadMedia`.
- Restricted/CORS-sensitive media may be fetched as blob/base64 and passed to `downloadForbiddenMedia`.

## Not Fully Recoverable

- Original comments, exact formatting, and local variable names are not recoverable from minified bundles.
- Module names are partly recoverable because Parcel dependency maps still contain source-like paths such as `src/services/...`.
- Better reconstruction is possible by extracting Parcel modules into separate files and manually renaming symbols around each service.
