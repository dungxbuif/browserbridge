import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { acquireSingleHostLock } from "../src/lock.js";

test("acquireSingleHostLock prevents duplicate live owners and releases cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-lock-"));
  const lockFile = join(dir, "bot.lock");
  try {
    const lock = await acquireSingleHostLock(lockFile);
    await assert.rejects(() => acquireSingleHostLock(lockFile), /another bot instance/);
    await lock.release();
    const reacquired = await acquireSingleHostLock(lockFile);
    await reacquired.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("acquireSingleHostLock replaces stale pid locks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-lock-"));
  const lockFile = join(dir, "bot.lock");
  try {
    await writeFile(lockFile, "99999999\nstale\n", { mode: 0o600 });
    const lock = await acquireSingleHostLock(lockFile);
    await lock.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
