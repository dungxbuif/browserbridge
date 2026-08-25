#!/usr/bin/env node
//
// Versioned PostgreSQL migration runner for BrowserBridge.
//
// Executes SQL files in <repo>/database/migrations/ in filename order and records
// applied versions in gateway.schema_migrations. This is the ONLY process that
// runs DDL: the Go server and Node bot verify the applied version and never
// create or alter tables.
//
// Usage:
//   node tools/migrate_db.mjs --plan            read-only report
//   node tools/migrate_db.mjs --apply           acquire lock, apply pending
//   node tools/migrate_db.mjs --verify          run schema/count/version checks
//   node tools/migrate_db.mjs --apply --verify  deployment path
//
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const requireFromBot = createRequire(new URL("../bot/package.json", import.meta.url));
const botDotenv = requireFromBot("dotenv");
const pg = requireFromBot("pg");

botDotenv.config({ path: new URL("../server/.env", import.meta.url).pathname });
botDotenv.config();

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "database", "migrations");
const LOCK_KEY = "browserbridge-schema-migration";

const LEGACY_TABLES = [
  "social_users",
  "media_assets",
  "mezon_users",
  "media_reactions",
  "media_archives",
  "bot_media_posts",
  "bot_event_dedup",
];

const hash = (sql) => createHash("sha256").update(sql, "utf8").digest("hex");

const listFiles = (directory = MIGRATIONS_DIR) =>
  readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
const versionOf = (name) => {
  const match = /^(\d{4})_[-_a-z0-9]+\.sql$/i.exec(name);
  if (!match) throw new Error(`invalid migration filename: ${name}`);
  return match[1];
};

export async function listMigrations(directoryURL = new URL("../database/migrations/", import.meta.url)) {
  const directory = fileURLToPath(directoryURL);
  return listFiles(directory).map((name) => {
    const sql = readFileSync(join(directory, name), "utf8");
    return {
      filename: name,
      version: versionOf(name),
      checksumSha256: hash(sql),
    };
  });
}

export function parseMigrationArgs(args) {
  const allowed = new Set(["--apply", "--plan", "--verify"]);
  if (args.length === 0 || args.some((arg) => !allowed.has(arg))) {
    throw new Error("invalid migration flags");
  }
  const apply = args.includes("--apply");
  const plan = args.includes("--plan");
  const verify = args.includes("--verify");
  if ((plan && (apply || verify)) || (!apply && !plan && !verify)) {
    throw new Error("invalid migration flags");
  }
  return { apply, verify, plan };
}

async function main() {
  let parsed;
  try {
    parsed = parseMigrationArgs(process.argv.slice(2));
  } catch {
    console.error(
      "Usage: node tools/migrate_db.mjs --plan | --apply | --verify | --apply --verify",
    );
    process.exit(2);
  }
  const { apply: doApply, plan: doPlan, verify: doVerify } = parsed;

  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl.trim()) {
    console.error("error: DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    await pool.query(
      "CREATE SCHEMA IF NOT EXISTS gateway; CREATE SCHEMA IF NOT EXISTS bot;",
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gateway.schema_migrations (
        version         TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        execution_ms    BIGINT NOT NULL DEFAULT 0
      );
    `);

    if (doPlan) {
      const applied = (await pool.query(
        "SELECT version, applied_at FROM gateway.schema_migrations ORDER BY version",
      )).rows;
      const files = listFiles();
      const current = new Set(applied.map((r) => r.version));
      for (const row of applied) console.log(`applied ${row.version} @ ${row.applied_at}`);
      for (const file of files) {
        if (!current.has(versionOf(file))) console.log(`pending ${versionOf(file)}`);
      }
      const counts = {};
      for (const table of LEGACY_TABLES) {
        try {
          const r = await pool.query(`SELECT count(*)::int AS c FROM public.${table}`);
          counts[table] = r.rows[0].c;
        } catch {
          counts[table] = "absent";
        }
      }
      console.log(`legacy_counts ${JSON.stringify(counts)}`);
      return;
    }

    if (doApply) {
      const applied = (await pool.query(
        "SELECT version, checksum_sha256 FROM gateway.schema_migrations",
      )).rows;
      const hashes = new Map(applied.map((r) => [r.version, r.checksum_sha256]));
      let count = 0;
      for (const file of listFiles()) {
        const version = versionOf(file);
        const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
        const expected = hash(sql);
        if (hashes.has(version)) {
          if (hashes.get(version) !== expected) {
            throw new Error(
              `checksum drift on ${version}: file changed after it was applied`,
            );
          }
          continue;
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
          const started = Date.now();
          await client.query(sql);
          await client.query(
            `INSERT INTO gateway.schema_migrations (version, checksum_sha256, execution_ms)
             VALUES ($1, $2, $3)`,
            [version, expected, Date.now() - started],
          );
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          await client
            .query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY])
            .catch(() => {});
          throw new Error(`migration ${version} failed: ${error.message}`);
        } finally {
          client.release();
        }
        count += 1;
      }
      console.log(`applied ${count} migration(s)`);
    }

    if (doVerify) {
      const files = listFiles();
      const present = new Set(
        (await pool.query("SELECT version FROM gateway.schema_migrations")).rows.map(
          (r) => r.version,
        ),
      );
      for (const file of files) {
        if (!present.has(versionOf(file))) {
          throw new Error(`pending migration ${versionOf(file)}; run --apply`);
        }
      }
      const checks = {
        "media ids distinct": `SELECT count(*) = count(DISTINCT id) AS ok FROM gateway.media_assets`,
        "social ids distinct": `SELECT count(*) = count(DISTINCT id) AS ok FROM gateway.social_users`,
        "assets have drive folder": `SELECT count(*) = 0 OR bool_and(drive_folder_id <> '') AS ok FROM gateway.media_assets`,
        "assets have paired delivery": `SELECT count(*) = 0 OR bool_and(EXISTS (SELECT 1 FROM bot.media_delivery_state d WHERE d.media_asset_id = m.id)) AS ok FROM gateway.media_assets m`,
        "platform checks hold": `SELECT count(*) = (SELECT count(*) FROM gateway.media_assets WHERE platform IN ('tiktok','instagram','facebook')) AS ok FROM gateway.media_assets`,
      };
      for (const [label, sql] of Object.entries(checks)) {
        const r = await pool.query(sql);
        if (!r.rows[0].ok) throw new Error(`verification failed: ${label}`);
      }
      console.log(`verification: ok (${files.length} versions)`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
