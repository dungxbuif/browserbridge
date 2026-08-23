export function filenameForMedia(user, media) {
  const username = sanitize(user.username || user.source_user_id || "social-user");
  const id = sanitize(media.media_id || media.post_id || Date.now());
  const ext = extensionForMedia(media);
  return `${username}-${id}.${ext}`;
}

export function extensionForMedia(media) {
  if (media.media_type === "video") return "mp4";
  const mime = String(media.mime_type || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

export function profileURLForUser(user) {
  if (user.profile_url) return user.profile_url;
  if (!user.username) return "";
  if (user.platform === "tiktok") return `https://www.tiktok.com/@${user.username}`;
  if (user.platform === "instagram") return `https://www.instagram.com/${user.username}/`;
  return "";
}

export function sanitize(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "media";
}
