import assert from "node:assert/strict";
import test from "node:test";

import { buildTargetUser, parseCollectUserMediaArgs } from "../../tools/collect_user_media.mjs";

test("parseCollectUserMediaArgs validates the supported bulk user media target", () => {
  const args = parseCollectUserMediaArgs(["--platform", "tiktok", "--username", "@creator", "--max-media", "250", "--active"]);

  assert.deepEqual(args, {
    platform: "tiktok",
    username: "creator",
    profileUrl: "",
    sourceUserId: "",
    displayName: "",
    maxMedia: 250,
    active: true,
  });
});

test("buildTargetUser creates the social user row expected by scrapeUser", () => {
  const user = buildTargetUser({
    platform: "tiktok",
    username: "creator",
    profileUrl: "",
    sourceUserId: "",
    displayName: "",
    maxMedia: 100,
    active: false,
  });

  assert.equal(user.platform, "tiktok");
  assert.equal(user.source_user_id, "creator");
  assert.equal(user.username, "creator");
  assert.equal(user.profile_url, "https://www.tiktok.com/@creator");
  assert.equal(user.metadata.collection_mode, "profile_media");
});
