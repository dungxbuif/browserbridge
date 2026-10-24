import { buildInstagramExtractorExpression } from "./instagram-extractor.js";
import { filenameForMedia, profileURLForUser } from "./media-utils.js";
import { buildTikTokExtractorExpression } from "./tiktok-extractor.js";

export const SUPPORTED_SOCIAL_PLATFORMS = ["tiktok", "instagram"];

export async function runConfiguredTick({ cfg, store, bridge, log = console }) {
  const platforms = platformsForConfig(cfg);
  if (platforms.length === 1) {
    const result = await runTick({ cfg: { ...cfg, platform: platforms[0] }, store, bridge, log });
    return { ...result, platforms: { [platforms[0]]: result } };
  }

  const summary = { users: 0, uploaded: 0, failed: 0, skippedExisting: 0, platforms: {} };
  for (const platform of platforms) {
    const result = await runTick({ cfg: { ...cfg, platform }, store, bridge, log });
    summary.platforms[platform] = result;
    summary.users += result.users;
    summary.uploaded += result.uploaded;
    summary.failed += result.failed;
    summary.skippedExisting += result.skippedExisting || 0;
  }
  return summary;
}

export async function runTick({ cfg, store, bridge, log = console }) {
  const users = await store.nextSocialUsersForScrape({
    platform: cfg.platform,
    cooldownSeconds: cfg.userCooldownSeconds,
    claimTTLSeconds: cfg.userClaimTTLSeconds,
    limit: cfg.maxUsersPerTick,
  });
  if (users.length === 0) {
    log.log("media worker: no social users due for scrape");
    return { users: 0, uploaded: 0, failed: 0, skippedExisting: 0 };
  }

  const summary = { users: users.length, uploaded: 0, failed: 0, skippedExisting: 0 };
  for (const user of users) {
    try {
      const result = await scrapeUser({ user, cfg, store, bridge, log });
      summary.uploaded += result.uploaded;
      summary.failed += result.failed;
      summary.skippedExisting += result.skippedExisting || 0;
    } catch (error) {
      summary.failed += 1;
      log.error(`media worker: scrape failed for ${user.platform}:${user.username || user.source_user_id}`, error);
      await store.markSocialUserScraped({
        id: user.id,
        claimId: user.scrape_claim_id || "",
        metadataPatch: {
          last_media_scrape_error: String(error?.message || error),
          last_media_scrape_error_at: new Date().toISOString(),
        },
      });
    }
  }
  return summary;
}

export async function scrapeUser({ user, cfg, store, bridge, log = console }) {
  const extractor = extractorForPlatform(user.platform);
  if (!extractor) {
    throw new Error(`unsupported platform ${user.platform}`);
  }
  const profileURL = profileURLForUser(user);
  if (!profileURL) throw new Error("profile_url is missing");

  const existingTab = await findExistingSocialTab({ bridge, user, profileURL });
  const navigationTab = existingTab ? null : await findNavigationPlatformTab({ bridge, user, profileURL, enabled: cfg.openProfileActive === true });
  const reusedTab = Boolean(existingTab || navigationTab);
  log.log(reusedTab ? `media worker: reusing tab ${(existingTab || navigationTab).id || (existingTab || navigationTab).tab_id} for ${profileURL}` : `media worker: opening ${profileURL}`);
  const tab = existingTab || navigationTab || await bridge.openTab(profileURL, { active: cfg.openProfileActive === true });
  const tabId = tab.id || tab.tab_id;
  if (!tabId) throw new Error("BrowserBridge did not return tab id");
  if (navigationTab) {
    await bridge.evaluate({
      tabId,
      world: "MAIN",
      expression: `(()=>{ location.assign(${JSON.stringify(profileURL)}); return { ok: true }; })()`,
    });
  }

  try {
    await sleep(cfg.pageLoadWaitMs);
    const extracted = await bridge.evaluate({
      tabId,
      world: "MAIN",
      expression: extractor.buildExpression({ maxMedia: cfg.maxMediaPerUser }),
    });
    const media = Array.isArray(extracted.media) ? extracted.media : [];
    let uploaded = 0;
    let failed = 0;
    let skippedExisting = 0;

    for (const item of media) {
      if (!item.media_url) continue;
      const mediaId = item.media_id || item.media_url;
      const filename = filenameForMedia(user, item);
      const metadata = {
        extractor: `bot/src/${extractor.name}-extractor.js`,
        extractor_name: extractor.name,
        page_url: item.page_url || extracted.url || profileURL,
        source: item.source || "",
        title: extracted.title || "",
        ...safeObject(item.metadata),
      };
      const job = await upsertMediaJobIfSupported({ store, user, item, mediaId, filename, metadata, extracted, profileURL });
      if (typeof store.mediaAssetExists === "function" && await store.mediaAssetExists({
        platform: user.platform,
        sourceUserId: user.source_user_id,
        mediaId,
      })) {
        skippedExisting += 1;
        await markMediaJobIfSupported(store, "markMediaDownloadJobSkipped", {
          id: job?.id,
          reason: "media asset already exists",
        });
        continue;
      }
      try {
        await markMediaJobIfSupported(store, "markMediaDownloadJobUploading", { id: job?.id });
        const uploadResult = await bridge.uploadMedia({
          tab_id: tabId,
          media_url: item.media_url,
          filename,
          mime_type: item.mime_type || "application/octet-stream",
          platform: user.platform,
          source_user_id: user.source_user_id,
          source_username: user.username || "",
          media_id: mediaId,
          post_id: item.post_id || "",
          media_type: item.media_type || "",
          preview_url: item.preview_url || "",
          metadata,
        });
        await markMediaJobIfSupported(store, "markMediaDownloadJobSucceeded", {
          id: job?.id,
          driveFileId: driveFileIdFromUploadResult(uploadResult),
          driveLink: driveLinkFromUploadResult(uploadResult),
          driveFolderId: driveFolderIdFromUploadResult(uploadResult),
        });
        uploaded += 1;
      } catch (error) {
        failed += 1;
        await markMediaJobIfSupported(store, "markMediaDownloadJobRetryWait", {
          id: job?.id,
          error: String(error?.message || error),
          retryDelaySeconds: retryDelaySecondsForJob(job),
        });
        log.error(`media worker: upload failed for ${item.media_id || item.media_url}`, error);
      }
    }

    await store.markSocialUserScraped({
      id: user.id,
      claimId: user.scrape_claim_id || "",
      metadataPatch: {
        last_media_scrape_at: new Date().toISOString(),
        last_media_scrape_count: media.length,
        last_media_upload_count: uploaded,
        last_media_upload_failed_count: failed,
        last_media_upload_skipped_existing_count: skippedExisting,
        last_media_scrape_url: extracted.url || profileURL,
        last_media_reused_tab: reusedTab,
      },
    });
    log.log(`media worker: ${user.platform}:${user.username || user.source_user_id} extracted=${media.length} uploaded=${uploaded} skipped_existing=${skippedExisting} failed=${failed}`);
    return { extracted: media.length, uploaded, skippedExisting, failed };
  } finally {
    if (!reusedTab && typeof bridge.closeTab === "function") {
      await bridge.closeTab(tabId).catch((error) => {
        log.error(`media worker: failed to close tab ${tabId}`, error);
      });
    }
  }
}

export function extractorForPlatform(platform) {
  if (platform === "tiktok") {
    return {
      name: "tiktok",
      buildExpression: buildTikTokExtractorExpression,
    };
  }
  if (platform === "instagram") {
    return {
      name: "instagram",
      buildExpression: buildInstagramExtractorExpression,
    };
  }
  return null;
}

async function findExistingSocialTab({ bridge, user, profileURL }) {
  if (typeof bridge.listTabs !== "function") return null;
  let tabs = [];
  try {
    tabs = await bridge.listTabs();
  } catch {
    return null;
  }
  if (!Array.isArray(tabs)) return null;
  const target = new URL(profileURL);
  const username = String(user.username || "").replace(/^@/, "").toLowerCase();
  const sourceID = String(user.source_user_id || "").replace(/^@/, "").toLowerCase();
  for (const tab of tabs) {
    const rawURL = tab.url || tab.pendingUrl || "";
    if (!rawURL) continue;
    let parsed;
    try {
      parsed = new URL(rawURL);
    } catch {
      continue;
    }
    if (parsed.hostname !== target.hostname) continue;
    const path = parsed.pathname.toLowerCase();
    if (user.platform === "tiktok" && (username || sourceID)) {
      if (path.startsWith(`/@${username}`) || path.startsWith(`/@${sourceID}`)) return tab;
    }
    if (user.platform === "instagram" && (username || sourceID)) {
      if (path === `/${username}/` || path === `/${sourceID}/` || path.startsWith(`/${username}/`) || path.startsWith(`/${sourceID}/`)) return tab;
    }
    if (rawURL.replace(/\/+$/, "") === profileURL.replace(/\/+$/, "")) return tab;
  }
  return null;
}

async function findNavigationPlatformTab({ bridge, user, profileURL, enabled }) {
  if (!enabled || user.platform !== "tiktok" || typeof bridge.listTabs !== "function") return null;
  let tabs = [];
  try {
    tabs = await bridge.listTabs();
  } catch {
    return null;
  }
  if (!Array.isArray(tabs)) return null;
  const target = new URL(profileURL);
  return tabs.find((tab) => {
    const rawURL = tab.url || tab.pendingUrl || "";
    if (!rawURL) return false;
    try {
      return new URL(rawURL).hostname === target.hostname;
    } catch {
      return false;
    }
  }) || null;
}

export function platformsForConfig(cfg) {
  const platform = String(cfg?.platform || "tiktok").trim().toLowerCase();
  if (platform === "all") return [...SUPPORTED_SOCIAL_PLATFORMS];
  if (SUPPORTED_SOCIAL_PLATFORMS.includes(platform)) return [platform];
  throw new Error(`unsupported social media platform ${platform}`);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function upsertMediaJobIfSupported({ store, user, item, mediaId, filename, metadata, extracted, profileURL }) {
  if (typeof store.upsertMediaDownloadJob !== "function") return null;
  return await store.upsertMediaDownloadJob({
    platform: user.platform,
    sourceUserId: user.source_user_id,
    sourceUsername: user.username || "",
    mediaId,
    postId: item.post_id || "",
    mediaUrl: item.media_url || "",
    mediaType: item.media_type || "",
    previewUrl: item.preview_url || "",
    pageUrl: item.page_url || extracted.url || profileURL,
    filename,
    mimeType: item.mime_type || "application/octet-stream",
    metadata,
  });
}

async function markMediaJobIfSupported(store, method, payload) {
  if (!payload.id || typeof store[method] !== "function") return;
  await store[method](payload);
}

function retryDelaySecondsForJob(job) {
  const attempts = Number.isInteger(job?.attempt_count) ? job.attempt_count : 0;
  return Math.min(3600, 300 * Math.max(1, 2 ** Math.max(0, attempts)));
}

function driveFileIdFromUploadResult(result) {
  return result?.file?.id || result?.drive_file_id || result?.driveFileId || result?.id || "";
}

function driveFolderIdFromUploadResult(result) {
  return result?.file?.parents?.[0] || result?.drive_folder_id || result?.driveFolderId || result?.folder_id || "";
}

function driveLinkFromUploadResult(result) {
  return result?.file?.web_view_link || result?.file?.webViewLink || result?.drive_link || result?.driveLink || result?.web_view_link || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
