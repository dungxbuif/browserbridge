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

  log.log(`media worker: opening ${profileURL}`);
  const tab = await bridge.openTab(profileURL, { active: true });
  const tabId = tab.id || tab.tab_id;
  if (!tabId) throw new Error("BrowserBridge did not return tab id");

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
      if (typeof store.mediaAssetExists === "function" && await store.mediaAssetExists({
        platform: user.platform,
        sourceUserId: user.source_user_id,
        mediaId,
      })) {
        skippedExisting += 1;
        continue;
      }
      try {
        await bridge.uploadMedia({
          tab_id: tabId,
          media_url: item.media_url,
          filename: filenameForMedia(user, item),
          mime_type: item.mime_type || "application/octet-stream",
          platform: user.platform,
          source_user_id: user.source_user_id,
          source_username: user.username || "",
          media_id: mediaId,
          post_id: item.post_id || "",
          media_type: item.media_type || "",
          preview_url: item.preview_url || "",
          metadata: {
            extractor: `bot/src/${extractor.name}-extractor.js`,
            extractor_name: extractor.name,
            page_url: item.page_url || extracted.url || profileURL,
            source: item.source || "",
            title: extracted.title || "",
            ...safeObject(item.metadata),
          },
        });
        uploaded += 1;
      } catch (error) {
        failed += 1;
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
      },
    });
    log.log(`media worker: ${user.platform}:${user.username || user.source_user_id} extracted=${media.length} uploaded=${uploaded} skipped_existing=${skippedExisting} failed=${failed}`);
    return { extracted: media.length, uploaded, skippedExisting, failed };
  } finally {
    if (typeof bridge.closeTab === "function") {
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

export function platformsForConfig(cfg) {
  const platform = String(cfg?.platform || "tiktok").trim().toLowerCase();
  if (platform === "all") return [...SUPPORTED_SOCIAL_PLATFORMS];
  if (SUPPORTED_SOCIAL_PLATFORMS.includes(platform)) return [platform];
  throw new Error(`unsupported social media platform ${platform}`);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
