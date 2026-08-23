import assert from "node:assert/strict";
import test from "node:test";

import {
  buttonEventID,
  handleButtonClick,
  handleChannelMessage,
  isMessageFromBot,
  isSendNextCommand,
  messageEventID,
  parseButtonID,
  sendNextMedia,
} from "../src/bot-core.js";

test("handleChannelMessage records Mezon user and sends next media command", async () => {
  const calls = [];
  const store = {
    async upsertMezonUser(user) {
      calls.push(["upsert", user]);
    },
  };
  const result = await handleChannelMessage({
    message: {
      sender_id: "u1",
      username: "user",
      display_name: "User",
      channel_id: "c1",
      content: { t: "*bb more" },
    },
    cfg: { commandPrefix: "*bb" },
    store,
    async sendNextMedia(postedBy, channelId) {
      calls.push(["sendNext", postedBy, channelId]);
    },
  });

  assert.deepEqual(result, { handled: true, action: "send_next_media" });
  assert.deepEqual(calls, [
    ["upsert", { id: "u1", username: "user", displayName: "User" }],
    ["sendNext", "command", "c1"],
  ]);
});

test("handleChannelMessage supports camelCase Mezon events", async () => {
  const calls = [];
  const result = await handleChannelMessage({
    message: {
      senderId: "u1",
      username: "user",
      displayName: "User",
      channelId: "c1",
      content: { t: "*bb" },
    },
    cfg: { commandPrefix: "*bb" },
    store: {
      async upsertMezonUser(user) {
        calls.push(["upsert", user]);
      },
    },
    async sendNextMedia(postedBy, channelId) {
      calls.push(["sendNext", postedBy, channelId]);
    },
  });

  assert.deepEqual(result, { handled: true, action: "send_next_media" });
  assert.deepEqual(calls, [
    ["upsert", { id: "u1", username: "user", displayName: "User" }],
    ["sendNext", "command", "c1"],
  ]);
});

test("isSendNextCommand supports configured send-more aliases", () => {
  assert.equal(isSendNextCommand("*bb", "*bb"), true);
  assert.equal(isSendNextCommand("*bb more", "*bb"), true);
  assert.equal(isSendNextCommand("*bb next", "*bb"), true);
  assert.equal(isSendNextCommand("*bb thêm", "*bb"), true);
  assert.equal(isSendNextCommand("*bb help", "*bb"), false);
  assert.equal(isSendNextCommand("*other next", "*bb"), false);
});

test("sendNextMedia sends media card and records post", async () => {
  const calls = [];
  const store = {
    async nextMedia() {
      calls.push(["nextMedia"]);
      return {
        id: 42,
        posting_claim_id: "claim-1",
        platform: "tiktok",
        source_username: "creator",
        media_id: "m1",
        post_id: "p1",
        filename: "m1.jpg",
        drive_link: "https://drive.example/file",
        preview_url: "https://cdn.example/m1.jpg",
      };
    },
    async recordPost(post) {
      calls.push(["recordPost", post]);
    },
  };
  const result = await sendNextMedia({
    cfg: { channelId: "default" },
    store,
    postedBy: "scheduler",
    async sendMessage(channelId, content) {
      calls.push(["send", channelId, content]);
      return { id: "msg1" };
    },
  });

  assert.equal(result.sent, true);
  assert.deepEqual(calls[0], ["nextMedia"]);
  assert.equal(calls[1][0], "send");
  assert.equal(calls[1][1], "default");
  assert.equal(calls[1][2].components.length, 3);
  assert.equal(calls[1][2].components[2].id, "bb:delete:42");
  assert.equal(calls[1][2].components[2].component.label, "Delete (admin)");
  assert.deepEqual(calls[2], ["recordPost", { mediaAssetId: 42, channelId: "default", messageId: "msg1", postedBy: "scheduler", claimId: "claim-1" }]);
});

test("sendNextMedia releases claim when send fails", async () => {
  const calls = [];
  await assert.rejects(() => sendNextMedia({
    cfg: { channelId: "default", mediaClaimTTLSeconds: 30 },
    store: {
      async nextMedia(args) {
        calls.push(["nextMedia", args]);
        return { id: 42, posting_claim_id: "claim-1", filename: "m1.jpg", drive_link: "https://drive.example/file" };
      },
      async releaseMediaClaim(payload) {
        calls.push(["release", payload]);
      },
    },
    postedBy: "scheduler",
    async sendMessage() {
      throw new Error("send failed");
    },
  }), /send failed/);
  assert.deepEqual(calls, [
    ["nextMedia", { claimTTLSeconds: 30 }],
    ["release", { mediaAssetId: 42, claimId: "claim-1" }],
  ]);
});

test("sendNextMedia sends empty-state text when no media is available", async () => {
  const calls = [];
  const result = await sendNextMedia({
    cfg: { channelId: "c1" },
    store: {
      async nextMedia() {
        return null;
      },
    },
    postedBy: "command",
    async sendMessage(channelId, content) {
      calls.push([channelId, content]);
    },
  });
  assert.deepEqual(result, { sent: false, reason: "no_media" });
  assert.equal(calls[0][0], "c1");
  assert.equal(calls[0][1].t, "Không có media nào sẵn sàng để gửi.");
});

test("sendNextMedia can stay silent when scheduler has no media", async () => {
  const calls = [];
  const result = await sendNextMedia({
    cfg: { channelId: "c1" },
    store: {
      async nextMedia() {
        return null;
      },
    },
    postedBy: "scheduler",
    notifyWhenEmpty: false,
    async sendMessage(channelId, content) {
      calls.push([channelId, content]);
    },
  });
  assert.deepEqual(result, { sent: false, reason: "no_media" });
  assert.deepEqual(calls, []);
});

test("handleButtonClick records like and dislike reactions", async () => {
  const calls = [];
  const store = {
    async upsertMezonUser(user) {
      calls.push(["upsert", user]);
    },
    async setReaction(reaction) {
      calls.push(["reaction", reaction]);
      return true;
    },
  };
  const result = await handleButtonClick({
    event: { button_id: "bb:like:42", sender_id: "u1", channel_id: "c1", message_id: "m1" },
    cfg: { adminUserId: "admin" },
    store,
    async sendText(channelId, text) {
      calls.push(["text", channelId, text]);
    },
  });

  assert.deepEqual(result, { handled: true, action: "like" });
  assert.deepEqual(calls[1], ["reaction", {
    mediaAssetId: 42,
    mezonUserId: "u1",
    reaction: "like",
    messageId: "m1",
    channelId: "c1",
  }]);
  assert.deepEqual(calls[2], ["text", "c1", "Đã ghi nhận like."]);
});

test("handleButtonClick prefers message_id over event id for button events", async () => {
  const calls = [];
  const result = await handleButtonClick({
    event: {
      id: "button-event-1",
      button_id: "bb:like:42",
      sender_id: "u1",
      channel_id: "c1",
      message_id: "message-with-button",
    },
    cfg: { adminUserId: "admin" },
    store: {
      async upsertMezonUser(user) {
        calls.push(["upsert", user]);
      },
      async setReaction(reaction) {
        calls.push(["reaction", reaction]);
        return true;
      },
    },
    async sendText(channelId, text) {
      calls.push(["text", channelId, text]);
    },
  });

  assert.deepEqual(result, { handled: true, action: "like" });
  assert.equal(calls[1][1].messageId, "message-with-button");
});

test("handleButtonClick enforces admin archive", async () => {
  const calls = [];
  const store = {
    async upsertMezonUser(user) {
      calls.push(["upsert", user]);
    },
    async archive(payload) {
      calls.push(["archive", payload]);
      return true;
    },
  };

  const denied = await handleButtonClick({
    event: { button_id: "bb:archive:42", sender_id: "u1", channel_id: "c1", message_id: "m1" },
    cfg: { adminUserId: "admin" },
    store,
    async sendText(channelId, text) {
      calls.push(["text", channelId, text]);
    },
  });
  assert.deepEqual(denied, { handled: true, action: "archive_denied" });
  assert.equal(calls.some((call) => call[0] === "archive"), false);

  const archived = await handleButtonClick({
    event: { button_id: "bb:archive:42", sender_id: "admin", channel_id: "c1", message_id: "m2" },
    cfg: { adminUserId: "admin" },
    store,
    async sendText(channelId, text) {
      calls.push(["text", channelId, text]);
    },
  });
  assert.deepEqual(archived, { handled: true, action: "archive" });
  assert.deepEqual(calls.findLast((call) => call[0] === "archive"), ["archive", {
    mediaAssetId: 42,
    adminUserId: "admin",
    reason: "admin_button",
    messageId: "m2",
    channelId: "c1",
  }]);
});

test("handleButtonClick reports unavailable media for stale buttons", async () => {
  const calls = [];
  const reaction = await handleButtonClick({
    event: { button_id: "bb:like:42", sender_id: "u1", channel_id: "c1", message_id: "m1" },
    cfg: { adminUserId: "admin" },
    store: {
      async upsertMezonUser(user) {
        calls.push(["upsert", user]);
      },
      async setReaction(payload) {
        calls.push(["reaction", payload]);
        return false;
      },
    },
    async sendText(channelId, text) {
      calls.push(["text", channelId, text]);
    },
  });
  assert.deepEqual(reaction, { handled: true, action: "media_unavailable" });
  assert.deepEqual(calls.at(-1), ["text", "c1", "Media này không còn tồn tại hoặc đã được archive."]);

  const archive = await handleButtonClick({
    event: { button_id: "bb:archive:42", sender_id: "admin", channel_id: "c1", message_id: "m1" },
    cfg: { adminUserId: "admin" },
    store: {
      async upsertMezonUser(user) {
        calls.push(["upsert", user]);
      },
      async archive(payload) {
        calls.push(["archive", payload]);
        return false;
      },
    },
    async sendText(channelId, text) {
      calls.push(["text", channelId, text]);
    },
  });
  assert.deepEqual(archive, { handled: true, action: "media_unavailable" });
  assert.deepEqual(calls.at(-1), ["text", "c1", "Media này không còn tồn tại hoặc đã được archive."]);
});

test("parseButtonID rejects unrelated or invalid buttons", () => {
  assert.equal(parseButtonID("other:like:1"), null);
  assert.equal(parseButtonID("bb:like:0"), null);
  assert.equal(parseButtonID("bb:like:7:extra"), null);
  assert.deepEqual(parseButtonID("bb:dislike:7"), { action: "dislike", mediaAssetId: 7 });
  assert.deepEqual(parseButtonID("bb:archive:7"), { action: "archive", mediaAssetId: 7 });
  assert.deepEqual(parseButtonID("bb:delete:7"), { action: "archive", mediaAssetId: 7 });
});

test("Mezon event helpers ignore self messages and build stable dedup IDs", () => {
  assert.equal(isMessageFromBot({ sender_id: "bot-1" }, { clientId: "bot-1" }), true);
  assert.equal(isMessageFromBot({ senderId: "bot-2" }, { user: { id: "bot-2" } }), true);
  assert.equal(isMessageFromBot({ sender_id: "u1" }, { clientId: "bot-1" }), false);
  assert.equal(messageEventID({ messageId: "m1" }), "message:m1");
  assert.equal(buttonEventID({ buttonId: "bb:like:7", messageId: "m1", senderId: "u1" }), "button:m1:u1:bb:like:7");
  assert.equal(buttonEventID({ id: "event-1", button_id: "bb:like:7", message_id: "m1", sender_id: "u1" }), "button:m1:u1:bb:like:7");
});
