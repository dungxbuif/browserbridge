import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { saveSocialUsersToDatabase } from "./social_db.mjs";

const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const dotenv = requireFromBot("dotenv");

dotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
dotenv.config();

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl.trim()) throw new Error("DATABASE_URL is required");
if (!["tiktok", "instagram"].includes(args.platform || "")) throw new Error("--platform must be tiktok or instagram");
if (!args.file) throw new Error("--file is required");

const parsed = JSON.parse(await readFile(args.file, "utf8"));
const users = Array.isArray(parsed) ? parsed : parsed.users;
if (!Array.isArray(users)) throw new Error("input JSON must be an array or an object with users[]");

const saved = await saveSocialUsersToDatabase(databaseUrl, args.platform, users);
console.log(JSON.stringify({
  ok: true,
  platform: args.platform,
  inputUsers: users.length,
  dbSaved: saved,
}, null, 2));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] || "";
    if (arg === "--platform") {
      result.platform = next;
      index += 1;
    } else if (arg === "--file") {
      result.file = next;
      index += 1;
    }
  }
  return result;
}
