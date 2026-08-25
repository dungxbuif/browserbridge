import assert from "node:assert/strict";
import test from "node:test";

import { extractorForPlatform, platformsForConfig, runConfiguredTick, runTick, scrapeUser } from "../src/media-worker-core.js";

const baseCfg = {
  platform: "tiktok",
  userCooldownSeconds: 1,
  userClaimTTLSeconds: 60,
  maxUsersPerTick: 2,
  maxMediaPerUser: 5,
  pageLoadWaitMs: 1,
};

test("scrapeUser uploads extracted media and marks social user scrape metadata", async () => {
  const user = {
    id: 10,
    platform: "tiktok",
    source_user_id: "source-1",
    username: "creator",
  };
  const calls = { uploads: [], marks: [], opened: [], closed: [] };
  const bridge = {
    async openTab(url, options) {
      calls.opened.push({ url, options });
      return { id: 123 };
    },
    async evaluate(payload) {
      assert.equal(payload.tabId, 123);
      assert.equal(payload.world, "MAIN");
      assert.match(payload.expression, /platform: "tiktok"/);
      return {
        url: "https://www.tiktok.com/@creator",
        title: "creator",
        media: [
          {
            media_id: "m1",
            post_id: "p1",
            media_url: "https://cdn.example/video.mp4",
            media_type: "video",
            mime_type: "video/mp4",
            preview_url: "https://cdn.example/cover.jpg",
            source: "test",
            metadata: { rank: 1 },
          },
          {
            media_id: "existing-media",
            post_id: "p-existing",
            media_url: "https://cdn.example/existing.mp4",
            media_type: "video",
            mime_type: "video/mp4",
          },
          { media_id: "missing-url" },
        ],
      };
    },
    async uploadMedia(payload) {
      calls.uploads.push(payload);
      return { status: "complete" };
    },
    async closeTab(tabId) {
      calls.closed.push(tabId);
      return { ok: true };
    },
  };
  const store = {
    async mediaAssetExists({ mediaId }) {
      return mediaId === "existing-media";
    },
    async markSocialUserScraped(payload) {
      calls.marks.push(payload);
    },
  };

  const result = await scrapeUser({ user, cfg: baseCfg, store, bridge, log: silentLog() });

  assert.deepEqual(calls.opened, [{ url: "https://www.tiktok.com/@creator", options: { active: true } }]);
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.uploads[0].tab_id, 123);
  assert.equal(calls.uploads[0].filename, "creator-m1.mp4");
  assert.equal(calls.uploads[0].platform, "tiktok");
  assert.equal(calls.uploads[0].source_user_id, "source-1");
  assert.equal(calls.uploads[0].metadata.extractor_name, "tiktok");
  assert.equal(calls.uploads[0].metadata.rank, 1);
  assert.equal(calls.marks.length, 1);
  assert.equal(calls.marks[0].id, 10);
  assert.equal(calls.marks[0].metadataPatch.last_media_scrape_count, 3);
  assert.equal(calls.marks[0].metadataPatch.last_media_upload_count, 1);
  assert.equal(calls.marks[0].metadataPatch.last_media_upload_skipped_existing_count, 1);
  assert.deepEqual(calls.closed, [123]);
  assert.deepEqual(result, { extracted: 3, uploaded: 1, skippedExisting: 1, failed: 0 });
});

test("scrapeUser closes the opened tab when evaluation fails", async () => {
  const calls = { closed: [] };
  await assert.rejects(() => scrapeUser({
    user: {
      id: 11,
      platform: "tiktok",
      source_user_id: "source-2",
      username: "creator2",
    },
    cfg: baseCfg,
    store: {
      async markSocialUserScraped() {},
    },
    bridge: {
      async openTab() {
        return { id: 321 };
      },
      async evaluate() {
        throw new Error("evaluate failed");
      },
      async closeTab(tabId) {
        calls.closed.push(tabId);
      },
    },
    log: silentLog(),
  }), /evaluate failed/);
  assert.deepEqual(calls.closed, [321]);
});

test("runTick marks failed user scrape without aborting remaining users", async () => {
  const users = [
    { id: 1, platform: "unsupported", source_user_id: "bad" },
    { id: 2, platform: "instagram", source_user_id: "ig-1", username: "creator" },
  ];
  const calls = { marks: [], uploads: 0 };
  const store = {
    async nextSocialUsersForScrape(query) {
      assert.deepEqual(query, { platform: "tiktok", cooldownSeconds: 1, claimTTLSeconds: 60, limit: 2 });
      return users;
    },
    async markSocialUserScraped(payload) {
      calls.marks.push(payload);
    },
  };
  const bridge = {
    async openTab() {
      return { id: 456 };
    },
    async evaluate() {
      return { url: "https://www.instagram.com/creator/", title: "creator", media: [] };
    },
    async uploadMedia() {
      calls.uploads += 1;
    },
  };

  const summary = await runTick({ cfg: baseCfg, store, bridge, log: silentLog() });

  assert.equal(summary.users, 2);
  assert.equal(summary.uploaded, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skippedExisting, 0);
  assert.equal(calls.marks.length, 2);
  assert.equal(calls.marks[0].id, 1);
  assert.match(calls.marks[0].metadataPatch.last_media_scrape_error, /unsupported platform/);
  assert.equal(calls.marks[1].id, 2);
  assert.equal(calls.marks[1].metadataPatch.last_media_scrape_count, 0);
});

test("runConfiguredTick expands all platforms and aggregates totals", async () => {
  const seenPlatforms = [];
  const store = {
    async nextSocialUsersForScrape(query) {
      seenPlatforms.push(query.platform);
      if (query.platform === "tiktok") {
        return [{ id: 21, platform: "tiktok", source_user_id: "tt", username: "tt" }];
      }
      return [{ id: 22, platform: "instagram", source_user_id: "ig", username: "ig" }];
    },
    async markSocialUserScraped() {},
  };
  const bridge = {
    async openTab() {
      return { id: 999 };
    },
    async evaluate() {
      return { url: "https://example.test/profile", title: "profile", media: [] };
    },
    async closeTab() {},
  };

  const summary = await runConfiguredTick({
    cfg: { ...baseCfg, platform: "all" },
    store,
    bridge,
    log: silentLog(),
  });

  assert.deepEqual(seenPlatforms, ["tiktok", "instagram"]);
  assert.equal(summary.users, 2);
  assert.equal(summary.uploaded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skippedExisting, 0);
  assert.deepEqual(Object.keys(summary.platforms), ["tiktok", "instagram"]);
});

test("platformsForConfig validates configured social platforms", () => {
  assert.deepEqual(platformsForConfig({ platform: "all" }), ["tiktok", "instagram"]);
  assert.deepEqual(platformsForConfig({ platform: "instagram" }), ["instagram"]);
  assert.throws(() => platformsForConfig({ platform: "youtube" }), /unsupported social media platform/);
});

test("extractorForPlatform supports tiktok and instagram", () => {
  assert.equal(extractorForPlatform("tiktok").name, "tiktok");
  assert.equal(extractorForPlatform("instagram").name, "instagram");
  assert.equal(extractorForPlatform("x"), null);
});

function silentLog() {
  return {
    log() {},
    error() {},
  };
}
