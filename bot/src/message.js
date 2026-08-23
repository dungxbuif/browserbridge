export function mediaMessage(media, { includeAdminButton }) {
  const title = `${media.platform || "unknown"} / ${media.source_username || media.source_user_id || "unknown"}`;
  const driveLink = media.drive_link || "";
  const preview = media.preview_url || driveLink;
  const description = [
    `Media ID: ${media.media_id}`,
    media.post_id ? `Post ID: ${media.post_id}` : "",
    media.filename ? `File: ${media.filename}` : "",
    driveLink ? `Drive: ${driveLink}` : "",
  ].filter(Boolean).join("\n");

  const embed = {
    title,
    description,
    color: "#2563EB",
    timestamp: new Date().toISOString(),
    footer: { text: `BrowserBridge media #${media.id}` },
  };
  if (preview) embed.image = { url: preview };

  const components = [
    button(`bb:like:${media.id}`, "Like", 3),
    button(`bb:dislike:${media.id}`, "Che", 2),
  ];
  if (includeAdminButton) components.push(button(`bb:delete:${media.id}`, "Delete (admin)", 4));

  return {
    t: "",
    embed: [embed],
    components,
  };
}

export function textMessage(text) {
  return { t: text };
}

function button(id, label, style) {
  return {
    id,
    type: 1,
    component: { label, style },
  };
}
