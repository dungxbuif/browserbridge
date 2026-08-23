import { mediaMessage, textMessage } from "./message.js";

export async function handleChannelMessage({ message, cfg, store, sendNextMedia }) {
  const senderId = eventField(message, "sender");
  const channelId = eventField(message, "channel");
  await store.upsertMezonUser({
    id: senderId,
    username: eventField(message, "username") || "",
    displayName: eventField(message, "displayName") || eventField(message, "clanNick") || "",
  });

  const text = messageText(message).trim().toLowerCase();
  const commandPrefix = String(cfg.commandPrefix || "").toLowerCase();
  if (isSendNextCommand(text, commandPrefix)) {
    await sendNextMedia("command", channelId);
    return { handled: true, action: "send_next_media" };
  }
  return { handled: false };
}

export function isSendNextCommand(text, commandPrefix) {
  const normalized = String(text || "").trim().toLowerCase();
  const prefix = String(commandPrefix || "").trim().toLowerCase();
  if (!prefix) return false;
  return normalized === prefix || [`${prefix} more`, `${prefix} next`, `${prefix} thêm`].includes(normalized);
}

export async function handleButtonClick({ event, cfg, store, sendText }) {
  const parsed = parseButtonID(eventField(event, "button"));
  if (!parsed) return { handled: false };

  const senderId = eventField(event, "sender");
  await store.upsertMezonUser({ id: senderId });

  const channelId = eventField(event, "channel");
  const messageId = eventField(event, "messageRef");

  if (parsed.action === "like" || parsed.action === "dislike") {
    const recorded = await store.setReaction({
      mediaAssetId: parsed.mediaAssetId,
      mezonUserId: senderId,
      reaction: parsed.action,
      messageId,
      channelId,
    });
    if (!recorded) {
      await sendText(channelId, "Media này không còn tồn tại hoặc đã được archive.");
      return { handled: true, action: "media_unavailable" };
    }
    await sendText(channelId, `Đã ghi nhận ${parsed.action}.`);
    return { handled: true, action: parsed.action };
  }

  if (parsed.action === "archive") {
    if (senderId !== cfg.adminUserId) {
      await sendText(channelId, "Bạn không có quyền archive media này.");
      return { handled: true, action: "archive_denied" };
    }
    const archived = await store.archive({
      mediaAssetId: parsed.mediaAssetId,
      adminUserId: senderId,
      reason: "admin_button",
      messageId,
      channelId,
    });
    if (!archived) {
      await sendText(channelId, "Media này không còn tồn tại hoặc đã được archive.");
      return { handled: true, action: "media_unavailable" };
    }
    await sendText(channelId, "Đã archive media.");
    return { handled: true, action: "archive" };
  }

  return { handled: false };
}

export async function sendNextMedia({ cfg, store, sendMessage, postedBy, channelId = cfg.channelId, notifyWhenEmpty = true }) {
  const media = await store.nextMedia({ claimTTLSeconds: cfg.mediaClaimTTLSeconds });
  if (!media) {
    if (notifyWhenEmpty) {
      await sendMessage(channelId, textMessage("Không có media nào sẵn sàng để gửi."));
    }
    return { sent: false, reason: "no_media" };
  }
  const claimId = media.posting_claim_id || "";
  try {
    const sent = await sendMessage(channelId, mediaMessage(media, { includeAdminButton: true }));
    const messageId = sent?.id || sent?.message_id || "";
    await store.recordPost({ mediaAssetId: media.id, channelId, messageId, postedBy, claimId });
    return { sent: true, mediaAssetId: media.id, messageId };
  } catch (error) {
    await store.releaseMediaClaim?.({ mediaAssetId: media.id, claimId }).catch(() => undefined);
    throw error;
  }
}

export function parseButtonID(buttonId) {
  if (!buttonId.startsWith("bb:")) return null;
  const parts = buttonId.split(":");
  if (parts.length !== 3) return null;
  const [, action, rawMediaId] = parts;
  if (!["like", "dislike", "archive", "delete"].includes(action)) return null;
  const mediaAssetId = Number.parseInt(rawMediaId, 10);
  if (!Number.isInteger(mediaAssetId) || mediaAssetId <= 0) return null;
  return { action: action === "delete" ? "archive" : action, mediaAssetId };
}

export function isMessageFromBot(message, client) {
  const senderId = eventField(message, "sender");
  if (!senderId) return false;
  const botIds = [
    client?.clientId,
    client?.client_id,
    client?.user?.id,
    client?.user?.user_id,
  ].filter(Boolean).map(String);
  return botIds.includes(String(senderId));
}

export function messageEventID(message) {
  const id = eventField(message, "message");
  return id ? `message:${id}` : "";
}

export function buttonEventID(event) {
  const buttonId = eventField(event, "button");
  const messageId = eventField(event, "messageRef");
  const senderId = eventField(event, "sender");
  return buttonId && messageId && senderId ? `button:${messageId}:${senderId}:${buttonId}` : "";
}

export function eventField(event, field) {
  if (!event) return "";
  const keys = {
    sender: ["sender_id", "senderId", "SenderID", "senderID"],
    channel: ["channel_id", "channelId", "ChannelID", "channelID"],
    message: ["id", "message_id", "messageId", "MessageID", "messageID"],
    messageRef: ["message_id", "messageId", "MessageID", "messageID", "id"],
    button: ["button_id", "buttonId", "ButtonID", "buttonID"],
    username: ["username", "user_name", "userName", "Username"],
    displayName: ["display_name", "displayName", "DisplayName"],
    clanNick: ["clan_nick", "clanNick", "ClanNick"],
  }[field] || [];
  for (const key of keys) {
    const value = event[key];
    if (value !== undefined && value !== null && String(value) !== "") return String(value);
  }
  return "";
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (content?.t !== undefined) return String(content.t);
  if (message?.text !== undefined) return String(message.text);
  if (typeof message?.ContentText === "function") return String(message.ContentText());
  return "";
}
