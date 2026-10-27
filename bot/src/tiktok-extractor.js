export function buildTikTokExtractorExpression({ maxMedia }) {
  return String.raw`
(async () => {
  const maxMedia = ${Number(maxMedia) || 20};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = Date.now();
  while (!document.querySelector('a[href*="/video/"], a[href*="/photo/"], img') && Date.now() - started < 15000) {
    await sleep(500);
  }

  const media = [];
  const seen = new Set();
  const push = (item) => {
    if (!item || !item.media_url) return;
    const mediaId = String(item.media_id || item.post_id || item.media_url);
    const key = mediaId + "|" + item.media_url;
    if (seen.has(key)) return;
    seen.add(key);
    media.push({
      platform: "tiktok",
      media_id: mediaId,
      post_id: String(item.post_id || mediaId),
      media_url: item.media_url,
      media_type: item.media_type || "",
      mime_type: item.mime_type || "",
      preview_url: item.preview_url || "",
      page_url: item.page_url || location.href,
      source: item.source || "unknown",
      metadata: item.metadata || {},
    });
  };
  const absoluteURL = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const resolved = new URL(value, location.href);
      return /^https?:$/.test(resolved.protocol) ? resolved.href : "";
    } catch {
      return "";
    }
  };
  const firstURL = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const resolved = absoluteURL(item);
        if (resolved) return resolved;
      }
      return "";
    }
    return absoluteURL(value);
  };
  const usernameFromLocation = () => {
    const match = location.pathname.match(/^\/@([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  };
  const walk = (node, depth = 0) => {
    if (!node || depth > 8 || media.length >= maxMedia) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    const video = node.video || node.videoData || node.video_info;
    const id = node.id || node.itemId || node.aweme_id || node.videoId;
    if (video && id) {
      const playAddr = video.playAddr || video.play_addr || video.downloadAddr || video.download_addr || video.bitRate?.[0]?.playAddr;
      const mediaURL = firstURL(playAddr?.urlList || playAddr?.url_list || playAddr);
      const cover = video.cover || video.originCover || video.dynamicCover || video.coverUrl;
      if (mediaURL) {
        push({
          media_id: id,
          post_id: id,
          media_url: mediaURL,
          media_type: "video",
          mime_type: "video/mp4",
          preview_url: firstURL(cover?.urlList || cover?.url_list || cover),
          page_url: node.shareUrl || node.share_url || (location.origin + "/video/" + id),
          source: "universal_state",
          metadata: { desc: node.desc || node.description || "", author: node.author || node.authorStats || {} },
        });
      }
    }
    const images = node.imagePost?.images || node.images || node.image_list;
    if (id && Array.isArray(images)) {
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const imageURL = firstURL(image?.imageURL?.urlList || image?.image_url?.url_list || image?.urlList || image?.url_list || image?.url);
        if (imageURL) {
          push({
            media_id: id + "_image_" + index,
            post_id: id,
            media_url: imageURL,
            media_type: "image",
            mime_type: "image/jpeg",
            preview_url: imageURL,
            page_url: node.shareUrl || node.share_url || location.href,
            source: "universal_state",
            metadata: { index, desc: node.desc || node.description || "" },
          });
        }
      }
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  const stateEl = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  let state = null;
  if (stateEl?.textContent) {
    try {
      state = JSON.parse(stateEl.textContent);
      walk(state);
    } catch (error) {
      console.warn("TikTok state parse failed", error?.message || error);
    }
  }

  const findProfileUser = (node, depth = 0) => {
    if (!node || depth > 8) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findProfileUser(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (typeof node !== "object") return null;
    if (node.secUid && (node.uniqueId || node.nickname || node.id)) return node;
    if (node.user?.secUid && (node.user.uniqueId || node.user.nickname || node.user.id)) return node.user;
    if (node.userInfo?.user?.secUid) return node.userInfo.user;
    for (const value of Object.values(node)) {
      const found = findProfileUser(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const baseParams = () => ({
    WebIdLastTime: Math.floor(Date.now() / 1000),
    aid: "1988",
    app_language: navigator.language,
    app_name: "tiktok_web",
    browser_language: navigator.language,
    browser_name: "Mozilla",
    browser_online: navigator.onLine,
    browser_platform: navigator.platform,
    browser_version: navigator.userAgent,
    channel: "tiktok_web",
    cookie_enabled: navigator.cookieEnabled,
    count: "16",
    coverFormat: "2",
    device_platform: "web_pc",
    focus_state: "true",
    from_page: "user",
    history_len: String(window.history.length),
    is_fullscreen: "false",
    is_page_visible: "true",
    language: navigator.language,
    os: navigator.platform || "web",
    referer: "",
    screen_height: String(screen.height),
    screen_width: String(screen.width),
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const fetchJSON = async (path, params) => {
    const query = new URLSearchParams({ ...baseParams(), ...params });
    const response = await fetch(path + "?" + query.toString(), {
      credentials: "include",
      headers: { accept: "application/json, text/plain, */*" },
    });
    if (!response.ok) return null;
    return response.json();
  };
  const normalizeTikTokItem = (item) => {
    if (!item || typeof item !== "object") return;
    const id = item.id || item.itemId || item.aweme_id || item.videoId;
    if (!id) return;
    const imagePost = item.imagePost || item.image_post;
    const images = imagePost?.images || item.images || item.image_list;
    if (Array.isArray(images) && images.length > 0) {
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const imageURL = firstURL(image?.imageURL?.urlList || image?.image_url?.url_list || image?.urlList || image?.url_list || image?.url);
        if (!imageURL) continue;
        push({
          media_id: id + "_image_" + index,
          post_id: id,
          media_url: imageURL,
          media_type: "image",
          mime_type: "image/jpeg",
          preview_url: imageURL,
          page_url: item.shareUrl || item.share_url || (location.origin + "/@" + usernameFromLocation() + "/photo/" + id),
          source: "tiktok_post_item_list",
          metadata: { index, desc: item.desc || item.description || "", createTime: item.createTime || "" },
        });
      }
      return;
    }
    const video = item.video || item.videoData || item.video_info;
    const playAddr = video?.playAddr || video?.play_addr || video?.downloadAddr || video?.download_addr || video?.bitrateInfo?.[0]?.PlayAddr || video?.bitRate?.[0]?.playAddr;
    const mediaURL = firstURL(playAddr?.UrlList || playAddr?.urlList || playAddr?.url_list || playAddr);
    const cover = video?.cover || video?.originCover || video?.dynamicCover || video?.coverUrl;
    if (mediaURL) {
      push({
        media_id: id,
        post_id: id,
        media_url: mediaURL,
        media_type: "video",
        mime_type: "video/mp4",
        preview_url: firstURL(cover?.urlList || cover?.url_list || cover),
        page_url: item.shareUrl || item.share_url || (location.origin + "/@" + usernameFromLocation() + "/video/" + id),
        source: "tiktok_post_item_list",
        metadata: { desc: item.desc || item.description || "", createTime: item.createTime || "", stats: item.statsV2 || item.stats || {} },
      });
    }
  };
  const collectUserPosts = async () => {
    if (media.length >= maxMedia) return;
    let profile = findProfileUser(state);
    const username = usernameFromLocation();
    if ((!profile?.secUid || (username && profile.uniqueId && profile.uniqueId.toLowerCase() !== username.toLowerCase())) && username) {
      const detail = await fetchJSON("/api/user/detail/", { uniqueId: username, secUid: "" });
      profile = detail?.userInfo?.user || detail?.user || profile;
    }
    const secUid = profile?.secUid || "";
    if (!secUid) return;
    let cursor = "0";
    let hasMore = true;
    let page = 0;
    const maxPages = Math.max(1, Math.ceil(maxMedia / 16) + 2);
    while (hasMore && page < maxPages && media.length < maxMedia) {
      const body = await fetchJSON("/api/post/item_list/", {
        count: "16",
        cursor,
        secUid,
        post_item_list_request_type: "0",
        video_encoding: "mp4",
        needPinnedItemIds: "true",
      });
      const items = body?.itemList || body?.items || [];
      for (const item of items) {
        normalizeTikTokItem(item);
        if (media.length >= maxMedia) break;
      }
      hasMore = Boolean(body?.hasMore || body?.has_more) && items.length > 0;
      cursor = String(body?.cursor ?? body?.maxCursor ?? cursor);
      page += 1;
    }
  };

  await collectUserPosts().catch((error) => {
    console.warn("TikTok post pagination failed", error?.message || error);
  });

  const scanDOMCovers = () => {
    for (const anchor of document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]')) {
      if (media.length >= maxMedia) break;
      const href = new URL(anchor.getAttribute("href"), location.href).href;
      const postId = href.match(/\/(?:video|photo)\/(\d+)/)?.[1] || href;
      const img = anchor.querySelector("img");
      const preview = firstURL(img?.currentSrc || img?.src || img?.getAttribute("src") || "");
      if (preview) {
        push({
          media_id: postId + "_cover",
          post_id: postId,
          media_url: preview,
          media_type: "image",
          mime_type: "image/jpeg",
          preview_url: preview,
          page_url: href,
          source: "dom_cover",
          metadata: { note: "Fallback cover image when playable URL is not exposed in page state." },
        });
      }
    }
  };

  scanDOMCovers();
  for (let round = 0; round < 6 && media.length < maxMedia; round += 1) {
    const before = media.length;
    window.scrollTo({ top: Math.min(document.documentElement.scrollHeight, window.scrollY + Math.max(window.innerHeight * 1.5, 900)), behavior: "instant" });
    await sleep(900);
    scanDOMCovers();
    if (media.length === before && round >= 2) break;
  }

  return {
    url: location.href,
    title: document.title,
    count: media.length,
    media: media.slice(0, maxMedia),
  };
})()
`;
}
