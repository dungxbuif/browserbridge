import { createRequire } from "node:module";
import { MediaStore } from "../bot/src/store.js";

export async function saveSocialUsersToDatabase(connectionString, platform, users) {
  const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
  const { Client } = requireFromBot("pg");
  const store = new MediaStore(connectionString);
  await store.migrate();
  await store.close();

  const client = new Client({ connectionString });
  await client.connect();
  try {
    let saved = 0;
    for (const user of users) {
      const sourceUserID = user.id || user.pk || user.secUid || user.username;
      if (!sourceUserID) continue;
      await client.query(
        `INSERT INTO social_users (platform, source_user_id, username, display_name, profile_url, avatar_url, metadata, last_scraped_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
         ON CONFLICT (platform, source_user_id) DO UPDATE SET
           username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           profile_url = EXCLUDED.profile_url,
           avatar_url = EXCLUDED.avatar_url,
           metadata = social_users.metadata || EXCLUDED.metadata,
           updated_at = now()`,
        [
          platform,
          sourceUserID,
          user.username || user.uniqueId || "",
          user.displayName || user.fullName || user.nickname || "",
          user.profileURL || user.profileUrl || "",
          user.avatarURL || user.avatarUrl || "",
          JSON.stringify({ ...user, imported_at: new Date().toISOString() }),
        ],
      );
      saved += 1;
    }
    return saved;
  } finally {
    await client.end();
  }
}

export function toCSV(rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return lines.join("\n") + "\n";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
