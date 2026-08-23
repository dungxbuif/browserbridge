export function buildInstagramExtractorExpression({ maxMedia }) {
  return String.raw`
(async () => {
  const maxMedia = ${Number(maxMedia) || 20};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const started = Date.now();
  while (!document.querySelector('article img, article video, meta[property="og:image"], meta[property="og:video"]') && Date.now() - started < 15000) {
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
      platform: "instagram",
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
    if (typeof value !== "string" || !value) return "";
    try {
      return new URL(value, location.href).href;
    } catch {
      return "";
    }
  };
  const isMediaURL = (value) => /^https?:\/\//.test(value || "") && (
    /\.(jpe?g|png|webp|mp4)(\?|$)/i.test(value) ||
    /cdninstagram\.com|fbcdn\.net/i.test(value)
  );
  const shortcodeFromURL = (value) => {
    const match = String(value || location.href).match(/\/(?:p|reel|tv)\/([^/?#]+)/);
    return match?.[1] || "";
  };
  const firstURL = (value) => {
    if (typeof value === "string" && isMediaURL(value)) return value;
    if (Array.isArray(value)) return value.find((item) => typeof item === "string" && isMediaURL(item)) || "";
    return "";
  };
  const walk = (node, depth = 0) => {
    if (!node || depth > 9 || media.length >= maxMedia) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    const id = node.id || node.pk || node.shortcode || node.code || node.media_id;
    const pageURL = node.permalink || node.share_url || (node.shortcode || node.code ? location.origin + "/p/" + (node.shortcode || node.code) + "/" : location.href);
    const videoURL = firstURL(node.video_url || node.video_versions?.map((item) => item.url) || node.video_dash_manifest);
    const imageURL = firstURL(
      node.display_url ||
      node.thumbnail_src ||
      node.image_versions2?.candidates?.map((item) => item.url) ||
      node.carousel_media?.[0]?.image_versions2?.candidates?.map((item) => item.url)
    );
    if (videoURL) {
      push({
        media_id: id || shortcodeFromURL(pageURL) || videoURL,
        post_id: id || shortcodeFromURL(pageURL) || "",
        media_url: videoURL,
        media_type: "video",
        mime_type: "video/mp4",
        preview_url: imageURL,
        page_url: pageURL,
        source: "page_state",
        metadata: { caption: node.caption?.text || node.edge_media_to_caption?.edges?.[0]?.node?.text || "" },
      });
    } else if (imageURL) {
      push({
        media_id: id || shortcodeFromURL(pageURL) || imageURL,
        post_id: id || shortcodeFromURL(pageURL) || "",
        media_url: imageURL,
        media_type: "image",
        mime_type: "image/jpeg",
        preview_url: imageURL,
        page_url: pageURL,
        source: "page_state",
        metadata: { caption: node.caption?.text || node.edge_media_to_caption?.edges?.[0]?.node?.text || "" },
      });
    }

    const carousel = node.carousel_media || node.edge_sidecar_to_children?.edges?.map((edge) => edge.node);
    if (Array.isArray(carousel)) {
      for (let index = 0; index < carousel.length; index += 1) {
        const child = carousel[index];
        const childVideo = firstURL(child?.video_url || child?.video_versions?.map((item) => item.url));
        const childImage = firstURL(child?.display_url || child?.image_versions2?.candidates?.map((item) => item.url));
        const url = childVideo || childImage;
        if (url) {
          push({
            media_id: (id || shortcodeFromURL(pageURL) || "carousel") + "_" + index,
            post_id: id || shortcodeFromURL(pageURL) || "",
            media_url: url,
            media_type: childVideo ? "video" : "image",
            mime_type: childVideo ? "video/mp4" : "image/jpeg",
            preview_url: childImage || "",
            page_url: pageURL,
            source: "page_state_carousel",
            metadata: { index },
          });
        }
      }
    }

    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  for (const script of document.querySelectorAll('script[type="application/json"], script:not([src])')) {
    if (media.length >= maxMedia) break;
    const text = script.textContent || "";
    if (!text.includes("instagram") && !text.includes("display_url") && !text.includes("video_url") && !text.includes("image_versions2")) continue;
    const candidates = [];
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) candidates.push(text.trim());
    const requireMatch = text.match(/require\("ScheduledServerJS"\).*?handleWithCustomApplyEach\(.*?(\{.*\})\);?/s);
    if (requireMatch) candidates.push(requireMatch[1]);
    for (const candidate of candidates) {
      try {
        walk(JSON.parse(candidate));
      } catch {
        // Ignore non-JSON inline scripts; DOM/OpenGraph fallbacks below still run.
      }
    }
  }

  for (const property of ["og:video", "og:video:url", "og:image", "og:image:secure_url"]) {
    const content = document.querySelector('meta[property="' + property + '"]')?.content || "";
    const url = absoluteURL(content);
    if (isMediaURL(url)) {
      const isVideo = property.includes("video") || /\.mp4(\?|$)/i.test(url);
      push({
        media_id: shortcodeFromURL(location.href) + "_" + property.replaceAll(":", "_"),
        post_id: shortcodeFromURL(location.href),
        media_url: url,
        media_type: isVideo ? "video" : "image",
        mime_type: isVideo ? "video/mp4" : "image/jpeg",
        preview_url: isVideo ? (document.querySelector('meta[property="og:image"]')?.content || "") : url,
        page_url: location.href,
        source: "open_graph",
        metadata: {},
      });
    }
  }

  for (const element of document.querySelectorAll("article video, article img, main video, main img")) {
    if (media.length >= maxMedia) break;
    const raw = element.currentSrc || element.src || element.getAttribute("src");
    const url = absoluteURL(raw);
    if (!isMediaURL(url)) continue;
    const isVideo = element.tagName.toLowerCase() === "video" || /\.mp4(\?|$)/i.test(url);
    push({
      media_id: shortcodeFromURL(location.href) + "_dom_" + media.length,
      post_id: shortcodeFromURL(location.href),
      media_url: url,
      media_type: isVideo ? "video" : "image",
      mime_type: isVideo ? "video/mp4" : "image/jpeg",
      preview_url: isVideo ? absoluteURL(element.poster || "") : url,
      page_url: location.href,
      source: "dom",
      metadata: { alt: element.getAttribute("alt") || "" },
    });
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
