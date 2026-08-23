export function buildTikTokExtractorExpression({ maxMedia }) {
  return String.raw`
(async () => {
  const maxMedia = ${Number(maxMedia) || 20};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = Date.now();
  while (!document.querySelector('a[href*="/video/"], img') && Date.now() - started < 15000) {
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
  const firstURL = (value) => {
    if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
    if (Array.isArray(value)) return value.find((item) => typeof item === "string" && /^https?:\/\//.test(item)) || "";
    return "";
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
  if (stateEl?.textContent) {
    try {
      walk(JSON.parse(stateEl.textContent));
    } catch (error) {
      console.warn("TikTok state parse failed", error?.message || error);
    }
  }

  for (const anchor of document.querySelectorAll('a[href*="/video/"]')) {
    if (media.length >= maxMedia) break;
    const href = new URL(anchor.getAttribute("href"), location.href).href;
    const postId = href.match(/\/video\/(\d+)/)?.[1] || href;
    const img = anchor.querySelector("img");
    const preview = img?.currentSrc || img?.src || "";
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

  return {
    url: location.href,
    title: document.title,
    count: media.length,
    media: media.slice(0, maxMedia),
  };
})()
`;
}
