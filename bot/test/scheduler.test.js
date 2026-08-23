import assert from "node:assert/strict";
import test from "node:test";

import { createGuardedRunner } from "../src/scheduler.js";

test("createGuardedRunner skips overlapping scheduled runs and allows the next interval after completion", async () => {
  const events = [];
  let releaseFirstRun;
  const firstRun = new Promise((resolve) => {
    releaseFirstRun = resolve;
  });
  const runner = createGuardedRunner(async (label) => {
    events.push(["start", label]);
    if (label === "first") await firstRun;
    events.push(["finish", label]);
    return label;
  }, {
    onSkip() {
      events.push(["skip"]);
    },
  });

  const first = runner("first");
  const second = await runner("second");
  assert.deepEqual(second, { skipped: true });

  releaseFirstRun();
  assert.deepEqual(await first, { skipped: false, value: "first" });
  assert.deepEqual(await runner("third"), { skipped: false, value: "third" });
  assert.deepEqual(events, [
    ["start", "first"],
    ["skip"],
    ["finish", "first"],
    ["start", "third"],
    ["finish", "third"],
  ]);
});

test("createGuardedRunner reports errors without leaving the runner stuck", async () => {
  const errors = [];
  let attempts = 0;
  const runner = createGuardedRunner(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("boom");
    return "ok";
  }, {
    onError(error) {
      errors.push(error.message);
    },
  });

  const failed = await runner();
  assert.equal(failed.skipped, false);
  assert.match(failed.error.message, /boom/);
  assert.deepEqual(errors, ["boom"]);
  assert.deepEqual(await runner(), { skipped: false, value: "ok" });
});
