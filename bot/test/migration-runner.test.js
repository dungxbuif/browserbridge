import assert from "node:assert/strict";
import test from "node:test";

import { listMigrations, parseMigrationArgs } from "../../tools/migrate_db.mjs";

test("lists ordered migration versions with content checksums", async () => {
  const migrations = await listMigrations(new URL("../../database/migrations/", import.meta.url));

  assert.deepEqual(migrations.map((migration) => migration.version), ["0001", "0002", "0003", "0004"]);
  assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksumSha256)));
});

test("rejects ambiguous migration command flags", () => {
  assert.deepEqual(parseMigrationArgs(["--apply", "--verify"]), { apply: true, verify: true, plan: false });
  assert.throws(() => parseMigrationArgs(["--apply", "--plan"]), /invalid migration flags/i);
  assert.throws(() => parseMigrationArgs(["--unknown"]), /invalid migration flags/i);
});
