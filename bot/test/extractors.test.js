import assert from "node:assert/strict";
import test from "node:test";

import { buildInstagramExtractorExpression } from "../src/instagram-extractor.js";
import { filenameForMedia, profileURLForUser, sanitize } from "../src/media-utils.js";
import { buildTikTokExtractorExpression } from "../src/tiktok-extractor.js";

test("filenameForMedia sanitizes social usernames and picks media extension", () => {
  assert.equal(
    filenameForMedia(
      { username: "creator name/@bad" },
      { media_id: "post:123", media_type: "video", mime_type: "video/mp4" },
    ),
    "creator-name-bad-post-123.mp4",
  );
  assert.equal(
    filenameForMedia(
      { source_user_id: "fallback user" },
      { post_id: "img 1", media_type: "image", mime_type: "image/webp" },
    ),
    "fallback-user-img-1.webp",
  );
});

test("profileURLForUser builds platform profile URLs when profile_url is absent", () => {
  assert.equal(profileURLForUser({ platform: "tiktok", username: "abc" }), "https://www.tiktok.com/@abc");
  assert.equal(profileURLForUser({ platform: "instagram", username: "abc" }), "https://www.instagram.com/abc/");
  assert.equal(profileURLForUser({ platform: "instagram", profile_url: "https://example.test/u" }), "https://example.test/u");
});

test("sanitize returns a bounded filesystem-safe token", () => {
  const value = sanitize(" abc / def ".repeat(40));
  assert.match(value, /^[a-zA-Z0-9._-]+$/);
  assert.ok(value.length <= 120);
});

test("extractor expressions identify their platforms", () => {
  const tiktok = buildTikTokExtractorExpression({ maxMedia: 5 });
  assert.match(tiktok, /platform: "tiktok"/);
  assert.match(tiktok, /const resolved = new URL\(value, location\.href\)/);
  assert.match(tiktok, /\/api\/post\/item_list\//);
  assert.match(tiktok, /hasMore/);
  assert.match(tiktok, /cursor/);
  assert.match(tiktok, /\/photo\//);
  assert.match(tiktok, /scrollTo/);
  assert.match(tiktok, /__browserBridgeTikTokItemList/);
  assert.match(buildInstagramExtractorExpression({ maxMedia: 5 }), /platform: "instagram"/);
});
