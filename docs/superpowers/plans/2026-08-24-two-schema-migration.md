# Two-Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Move BrowserBridge runtime persistence from unqualified public tables into exactly gateway and bot schemas without losing legacy IDs or bot history.

**Architecture:** tools/migrate_db.mjs becomes the single versioned DDL owner. It acquires a PostgreSQL advisory lock, applies immutable SQL files, and records checksums in gateway.schema_migrations. Go server, bot store, social tools and verifiers use schema-qualified queries only; bot delivery fields leave gateway.media_assets for bot.media_delivery_state.

**Tech Stack:** PostgreSQL 16, Node.js ES modules with pg, Go 1.25 with database/sql and pgx, Docker Compose.

**Spec:** docs/work/designs/DESIGN-005-DATABASE.md, docs/work/tickets/TICKET-008-two-schema-migration.md, docs/decisions/ADR-003-two-schema-ownership-and-fixed-drive-destination.md

## Global Constraints

- Exactly two application schemas: gateway and bot; runtime code never writes an unqualified application table.
- Migration DDL lives only in database/migrations; server and bot stores never create or alter schema.
- Preserve legacy BIGINT IDs and bot/social rows; abort with LEGACY_MEDIA_RECONCILIATION_REQUIRED before cutover if public.media_assets is non-empty.
- Keep legacy public tables available as read-only compatibility views. Never drop schemas, rows or Drive files in this ticket.
- The only allowed social platform values are tiktok, instagram and facebook.
- Do not log credentials, cookies, signed URLs, raw metadata or provider response bodies.
- Run every test first in its expected failing state, then implement the minimum code that makes it pass.

---

### Task 1: Versioned migration runner

**Files:**

- Create: database/migrations/0001_create_application_schemas.sql
- Create: database/migrations/0002_backfill_legacy_tables.sql
- Create: database/migrations/0003_add_cross_schema_constraints.sql
- Create: database/migrations/0004_public_compatibility_views.sql
- Modify: tools/migrate_db.mjs
- Create: bot/test/migration-runner.test.js

**Interfaces:**

- Exports listMigrations(directory), parseMigrationArgs(argv), and runMigrations({ connectionString, apply, verify, plan }).
- CLI accepts exactly --plan, --apply, --verify, or --apply --verify.
- Persists gateway.schema_migrations(version, checksum_sha256, applied_at, execution_ms).

- [ ] **Step 1: Write failing manifest tests**

~~~
import test from "node:test";
import assert from "node:assert/strict";
import { listMigrations, parseMigrationArgs } from "../../tools/migrate_db.mjs";

test("migration manifest orders immutable SQL versions", async () => {
  const migrations = await listMigrations(new URL("../../database/migrations/", import.meta.url));
  assert.deepEqual(migrations.map((item) => item.version), ["0001", "0002", "0003", "0004"]);
  assert.ok(migrations.every((item) => /^[a-f0-9]{64}$/.test(item.checksumSha256)));
});

test("migration CLI rejects ambiguous modes", () => {
  assert.deepEqual(parseMigrationArgs(["--apply", "--verify"]), { apply: true, verify: true, plan: false });
  assert.throws(() => parseMigrationArgs(["--apply", "--plan"]), /invalid migration flags/i);
});
~~~

- [ ] **Step 2: Verify the test is red**

Run: rtk node --test bot/test/migration-runner.test.js

Expected: FAIL because migration exports and directory do not exist.

- [ ] **Step 3: Implement the runner**

Create the ledger before applying versioned files. Sort numeric filename prefixes, calculate SHA-256 from bytes, reject checksum drift and missing intermediate versions, acquire pg_advisory_lock(hashtext('browserbridge-schema-migration')), execute each migration and ledger insert in one transaction, then always release the advisory lock. Plan mode is read-only and prints only version/count metadata.

~~~
export function parseMigrationArgs(argv) {
  const args = new Set(argv);
  const apply = args.has("--apply");
  const verify = args.has("--verify");
  const plan = args.has("--plan");
  if (args.size !== Number(apply) + Number(verify) + Number(plan) || (plan && (apply || verify))) {
    throw new Error("invalid migration flags");
  }
  return { apply, verify, plan };
}
~~~

- [ ] **Step 4: Verify green**

Run: rtk node --test bot/test/migration-runner.test.js

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add database/migrations tools/migrate_db.mjs bot/test/migration-runner.test.js
git commit -m "feat: add versioned schema migration runner"
~~~

### Task 2: Two-schema DDL, backfill and compatibility views

**Files:**

- Modify: database/migrations/0001_create_application_schemas.sql
- Modify: database/migrations/0002_backfill_legacy_tables.sql
- Modify: database/migrations/0003_add_cross_schema_constraints.sql
- Modify: database/migrations/0004_public_compatibility_views.sql
- Create: tools/verify_schema_migration.mjs

**Interfaces:**

- Migration outputs gateway.social_users, gateway.media_assets, bot.mezon_users, bot.media_delivery_state, bot.media_reactions, bot.media_archives, bot.media_posts and bot.event_dedup.
- A non-empty legacy public.media_assets returns LEGACY_MEDIA_RECONCILIATION_REQUIRED before a public rename or compatibility view creation.
- Existing social and bot IDs, counts and relationships survive unchanged.

- [ ] **Step 1: Write the failing migration verifier**

Seed a disposable current public schema with social users, Mezon users, reactions, archives, posts and dedup rows, while keeping media_assets empty. Invoke runMigrations, then assert schema ownership, preserved IDs/counts, valid cross-schema references, sequence positions and read-only public compatibility views. Add a second scenario inserting one legacy media asset and assert the exact preflight error with no cutover.

- [ ] **Step 2: Verify the test is red**

Run: rtk node tools/verify_schema_migration.mjs

Expected: FAIL because current migration delegates to bot MediaStore.migrate and creates public tables.

- [ ] **Step 3: Implement SQL files**

0001 creates gateway, bot, the migration ledger and TICKET-008 core target tables without public dependencies. 0002 uses INSERT ... SELECT with explicit columns to preserve IDs, asserts that public.media_assets is empty, and resets target sequences after copy. 0003 adds platform/type checks, unique keys, indexes and cross-schema foreign keys. Bot-to-asset foreign keys use ON DELETE RESTRICT and reaction-to-Mezon-user references use ON DELETE CASCADE. 0004 renames legacy tables to their _legacy_20260823 names and creates compatibility views at the old public names; it leaves all legacy relations intact.

- [ ] **Step 4: Verify green and idempotence**

Run: rtk node tools/verify_schema_migration.mjs

Expected: PASS, including a second apply, preserved counts/IDs and rejected non-empty legacy media.

- [ ] **Step 5: Commit**

~~~
git add database/migrations tools/verify_schema_migration.mjs
git commit -m "feat: migrate BrowserBridge data into gateway and bot schemas"
~~~

### Task 3: Schema-qualified Go store

**Files:**

- Modify: server/internal/store/postgres.go
- Modify: server/internal/bridge/server_test.go
- Create: server/internal/store/postgres_integration_test.go

**Interfaces:**

- OpenPostgres verifies migration version 0004 and never executes CREATE, ALTER, DROP or migration SQL.
- SaveMediaAsset writes gateway.media_assets. MediaAsset gains DriveFolderID, PageURL, PostType, Position and ChecksumSHA256 with zero-value compatibility for current callers.
- UpsertSocialUser writes gateway.social_users and preserves current last_scraped_at semantics.

- [ ] **Step 1: Write failing Go integration tests**

~~~
func TestOpenPostgresRejectsMissingSchemaVersion(t *testing.T) {
    _, err := OpenPostgres(context.Background(), testDatabaseURL(t))
    if !strings.Contains(err.Error(), "required schema migration 0004") {
        t.Fatalf("expected schema version error, got %v", err)
    }
}

func TestPostgresWritesGatewayTables(t *testing.T) {
    store := openMigratedStore(t)
    if err := store.UpsertSocialUser(context.Background(), SocialUser{Platform: "tiktok", SourceUserID: "user-1"}); err != nil {
        t.Fatal(err)
    }
    assertTableCount(t, "gateway.social_users", 1)
}
~~~

Use standard-library test helpers. Skip only if DATABASE_URL is absent.

- [ ] **Step 2: Verify the test is red**

Run: rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./internal/store -run 'Test(OpenPostgres|PostgresWritesGateway)' -v

Expected: FAIL because OpenPostgres calls Migrate and queries are unqualified.

- [ ] **Step 3: Implement minimum qualified store behavior**

Replace Migrate with VerifySchema, which selects version 0004 from gateway.schema_migrations and returns an actionable error when missing. Prefix each Go query with gateway. Remove bot DDL from the server completely. Keep existing upload HTTP behavior stable while persisting the final asset ownership fields.

- [ ] **Step 4: Verify green**

Run: rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./internal/store ./internal/bridge -v

Run: rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./...

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add server/internal/store/postgres.go server/internal/store/postgres_integration_test.go server/internal/bridge/server_test.go
git commit -m "refactor: use gateway schema from Go media store"
~~~

### Task 4: Bot state ownership and qualified Node/tools queries

**Files:**

- Modify: bot/src/store.js
- Modify: tools/social_db.mjs
- Modify: tools/verify_bot_db_flow.mjs
- Modify: tools/verify_worker_db_flow.mjs
- Modify: tools/verify_social_user_import.mjs
- Modify: tools/media_status.mjs
- Modify: tools/upsert_media_asset.mjs
- Modify: tools/upsert_social_user.mjs
- Modify: tools/import_social_users.mjs
- Modify: bot/test/bot-core.test.js
- Modify: bot/test/media-worker-core.test.js

**Interfaces:**

- MediaStore no longer exposes migrate; processes require a verified migration before startup.
- Social users/assets use gateway tables. Mezon users, delivery state, reactions, archives, posts and dedup use bot tables.
- nextMedia joins gateway.media_assets and bot.media_delivery_state and claims only bot delivery state.

- [ ] **Step 1: Write failing Node tests**

Create migrated test setup, then assert nextMedia returns a gateway asset while its claim is persisted only in bot.media_delivery_state. Assert source data is absent from bot and bot archive/post fields are absent from gateway.media_assets.

- [ ] **Step 2: Verify the tests are red**

Run: rtk node --test bot/test/bot-core.test.js bot/test/media-worker-core.test.js

Expected: FAIL because current store creates/query unqualified tables and stores delivery fields on media_assets.

- [ ] **Step 3: Implement qualified repositories and tools**

Remove MediaStore.migrate. Update every query to use gateway.<table> or bot.<table>; do not set PostgreSQL search_path. Move archive/post/count/claim reads and writes to bot.media_delivery_state. Make all direct tool SQL schema-qualified and make startup report the migration command when version 0004 is missing.

- [ ] **Step 4: Verify green**

Run: rtk npm run check

Run: rtk node tools/verify_bot_db_flow.mjs

Run: rtk node tools/verify_worker_db_flow.mjs

Run: rtk node tools/verify_social_user_import.mjs

Expected: PASS twice with no public runtime writes.

- [ ] **Step 5: Commit**

~~~
git add bot/src/store.js bot/test tools
git commit -m "refactor: separate gateway and bot PostgreSQL ownership"
~~~

### Task 5: Migration-first integration and reconciliation

**Files:**

- Modify: scripts/setup-local-postgres.sh
- Modify: scripts/doctor.sh
- Modify: docs/work/tickets/TICKET-008-two-schema-migration.md
- Modify: docs/work/VALIDATION_MATRIX.md
- Modify: docs/CONTEXT.md
- Modify: docs/work/BACKLOG.md
- Modify: docs/releases/CHANGELOG.md

**Interfaces:**

- setup-local-postgres runs node tools/migrate_db.mjs --apply --verify after PostgreSQL is ready.
- doctor runs verify_schema_migration before bot/worker verifiers.
- No application process creates tables after migration.

- [ ] **Step 1: Write a failing doctor-order assertion**

Add --assert-doctor-order to verify_schema_migration.mjs. It reads scripts/doctor.sh and fails unless verify_schema_migration runs before verify_bot_db_flow and setup-local-postgres uses the migration runner instead of bot store DDL.

- [ ] **Step 2: Verify it is red**

Run: rtk node tools/verify_schema_migration.mjs --assert-doctor-order

Expected: FAIL against current scripts.

- [ ] **Step 3: Wire migration-first startup and reconcile artifacts**

Keep cleanup non-destructive. Record commands/results, compatibility-view rollback window and remaining owner UAT. Move TICKET-008 through ready, in_progress and in_review only after its acceptance criteria/test evidence are met; mark verified only after the owner approves the local PostgreSQL UAT.

- [ ] **Step 4: Run final verification**

Run: rtk env SKIP_DRIVE_UPLOAD=true ./scripts/doctor.sh

Run: rtk env GOCACHE=/private/tmp/browserbridge-go-cache go test ./...

Run: rtk npm run check

Expected: PASS. The schema verifier must prove application table ownership is gateway/bot and old public names are views.

- [ ] **Step 5: Commit**

~~~
git add scripts docs tools
git commit -m "test: verify two-schema migration cutover"
~~~

## Plan Self-Review

- Spec coverage: all TICKET-008 acceptance criteria map to Tasks 1-5. Retry jobs, Facebook and agent control remain excluded from this foundation slice.
- Placeholder scan: every task names files, interfaces, a red test, expected result and verification command.
- Type consistency: legacy entity IDs remain BIGINT; new migration/job IDs use text version/UUID contracts; bot state references gateway media assets.

