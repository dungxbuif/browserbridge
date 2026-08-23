import { createRequire } from "node:module";
import { MediaStore } from "../bot/src/store.js";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const botDotenv = requireFromBot("dotenv");

botDotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
botDotenv.config();

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) {
  throw new Error("DATABASE_URL is required");
}

const store = new MediaStore(databaseUrl);
await store.migrate();

try {
  const counts = {};
  for (const table of ["social_users", "media_assets", "mezon_users", "media_reactions", "media_archives", "bot_media_posts", "bot_event_dedup"]) {
    const { rows } = await store.pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    counts[table] = rows[0].count;
  }
  console.log(JSON.stringify({ ok: true, migrated: true, counts }, null, 2));
} finally {
  await store.close();
}
