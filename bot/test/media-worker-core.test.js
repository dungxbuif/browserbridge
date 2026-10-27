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
  const calls = { events: [], uploads: [], marks: [], opened: [], closed: [] };
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
      calls.events.push(["upload", payload.media_id]);
      calls.uploads.push(payload);
      return { file: { id: "drive-m1", web_view_link: "https://drive.example/m1" } };
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
    async upsertMediaDownloadJob(payload) {
      calls.events.push(["upsert-job", payload.mediaId]);
      return { id: `job-${payload.mediaId}` };
    },
    async markMediaDownloadJobUploading(payload) {
      calls.events.push(["mark-uploading", payload.id]);
    },
    async markMediaDownloadJobSucceeded(payload) {
      calls.events.push(["mark-succeeded", payload.id, payload.driveFileId, payload.driveLink]);
    },
    async markMediaDownloadJobSkipped(payload) {
      calls.events.push(["mark-skipped", payload.id, payload.reason]);
    },
    async markSocialUserScraped(payload) {
      calls.marks.push(payload);
    },
  };

  const result = await scrapeUser({ user, cfg: baseCfg, store, bridge, log: silentLog() });

  assert.deepEqual(calls.opened, [{ url: "https://www.tiktok.com/@creator", options: { active: false } }]);
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
  assert.deepEqual(calls.events, [
    ["upsert-job", "m1"],
    ["mark-uploading", "job-m1"],
    ["upload", "m1"],
    ["mark-succeeded", "job-m1", "drive-m1", "https://drive.example/m1"],
    ["upsert-job", "existing-media"],
    ["mark-skipped", "job-existing-media", "media asset already exists"],
  ]);
  assert.deepEqual(calls.closed, [123]);
  assert.deepEqual(result, { extracted: 3, uploaded: 1, skippedExisting: 1, failed: 0 });
});

test("scrapeUser marks persisted media job retry_wait when upload fails", async () => {
  const user = {
    id: 13,
    platform: "tiktok",
    source_user_id: "source-4",
    username: "creator4",
  };
  const calls = { retryWait: [], marks: [] };
  const bridge = {
    async openTab() {
      return { id: 555 };
    },
    async evaluate() {
      return {
        url: "https://www.tiktok.com/@creator4",
        title: "creator4",
        media: [
          {
            media_id: "rate-limited",
            post_id: "p-rate-limited",
            media_url: "https://cdn.example/rate-limited.mp4",
            media_type: "video",
            mime_type: "video/mp4",
          },
        ],
      };
    },
    async uploadMedia() {
      throw new Error("HTTP 429 Too Many Requests");
    },
    async closeTab() {},
  };
  const store = {
    async mediaAssetExists() {
      return false;
    },
    async upsertMediaDownloadJob(payload) {
      assert.equal(payload.mediaId, "rate-limited");
      return { id: 44, attempt_count: 0 };
    },
    async markMediaDownloadJobUploading(payload) {
      assert.equal(payload.id, 44);
    },
    async markMediaDownloadJobRetryWait(payload) {
      calls.retryWait.push(payload);
    },
    async markSocialUserScraped(payload) {
      calls.marks.push(payload);
    },
  };

  const result = await scrapeUser({ user, cfg: baseCfg, store, bridge, log: silentLog() });

  assert.deepEqual(result, { extracted: 1, uploaded: 0, skippedExisting: 0, failed: 1 });
  assert.equal(calls.retryWait.length, 1);
  assert.equal(calls.retryWait[0].id, 44);
  assert.match(calls.retryWait[0].error, /429/);
  assert.equal(calls.retryWait[0].retryDelaySeconds, 300);
  assert.equal(calls.marks[0].metadataPatch.last_media_upload_failed_count, 1);
});

test("scrapeUser reuses an existing social tab and does not close it", async () => {
  const user = {
    id: 12,
    platform: "tiktok",
    source_user_id: "source-3",
    username: "creator3",
    profile_url: "https://www.tiktok.com/@creator3",
  };
  const calls = { opened: [], closed: [], listed: 0, marks: [] };
  const bridge = {
    async listTabs() {
      calls.listed += 1;
      return [
        { id: 777, url: "https://www.tiktok.com/@creator3", active: true },
      ];
    },
    async openTab(url, options) {
      calls.opened.push({ url, options });
      return { id: 778 };
    },
    async evaluate(payload) {
      assert.equal(payload.tabId, 777);
      return { url: user.profile_url, title: "creator3", media: [] };
    },
    async closeTab(tabId) {
      calls.closed.push(tabId);
    },
  };
  const store = {
    async markSocialUserScraped(payload) {
      calls.marks.push(payload);
    },
  };

  const result = await scrapeUser({ user, cfg: baseCfg, store, bridge, log: silentLog() });

  assert.equal(calls.listed, 1);
  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.closed, []);
  assert.equal(calls.marks[0].metadataPatch.last_media_reused_tab, true);
  assert.deepEqual(result, { extracted: 0, uploaded: 0, skippedExisting: 0, failed: 0 });
});

test("scrapeUser can open a one-shot profile tab active for platform rendering", async () => {
  const calls = { opened: [] };
  const bridge = {
    async openTab(url, options) {
      calls.opened.push({ url, options });
      return { id: 888 };
    },
    async evaluate() {
      return { url: "https://www.tiktok.com/@activecreator", title: "activecreator", media: [] };
    },
    async closeTab() {},
  };
  const store = {
    async markSocialUserScraped() {},
  };

  await scrapeUser({
    user: { id: 14, platform: "tiktok", source_user_id: "activecreator", username: "activecreator" },
    cfg: { ...baseCfg, openProfileActive: true },
    store,
    bridge,
    log: silentLog(),
  });

  assert.deepEqual(calls.opened, [{ url: "https://www.tiktok.com/@activecreator", options: { active: true } }]);
});

test("scrapeUser can navigate an existing TikTok tab for one-shot profile collection", async () => {
  const calls = { opened: [], closed: [], evaluations: [], marks: [] };
  const bridge = {
    async listTabs() {
      return [{ id: 901, url: "https://www.tiktok.com/@owner", active: true }];
    },
    async openTab(url, options) {
      calls.opened.push({ url, options });
      return { id: 902 };
    },
    async evaluate(payload) {
      calls.evaluations.push(payload);
      if (/location\.assign/.test(payload.expression)) return { ok: true };
      return { url: "https://www.tiktok.com/@targetcreator", title: "targetcreator", media: [] };
    },
    async closeTab(tabId) {
      calls.closed.push(tabId);
    },
  };
  const store = {
    async markSocialUserScraped(payload) {
      calls.marks.push(payload);
    },
  };

  await scrapeUser({
    user: { id: 15, platform: "tiktok", source_user_id: "targetcreator", username: "targetcreator" },
    cfg: { ...baseCfg, openProfileActive: true },
    store,
    bridge,
    log: silentLog(),
  });

  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.closed, []);
  assert.equal(calls.evaluations[0].tabId, 901);
  assert.match(calls.evaluations[0].expression, /location\.assign\("https:\/\/www\.tiktok\.com\/@targetcreator"\)/);
  assert.equal(calls.evaluations[1].tabId, 901);
  assert.equal(calls.marks[0].metadataPatch.last_media_reused_tab, true);
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
