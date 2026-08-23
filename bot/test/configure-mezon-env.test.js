import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repoRoot = new URL("../..", import.meta.url).pathname;
const cli = join(repoRoot, "tools/configure_mezon_env.mjs");

test("configure_mezon_env dry-run preserves existing env values without printing secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserbridge-mezon-env-"));
  const envFile = join(dir, ".env");
  await writeFile(envFile, "MEZON_BOT_TOKEN=existing-secret\nMEZON_HOST=gw.mezon.ai\n");

  const result = await runCLI([
    "--dry-run",
    "--target-env-file", envFile,
    "--bot-id", "bot",
    "--channel", "channel",
    "--admin", "admin",
    "--port", "443",
    "--use-ssl", "true",
  ]);

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /existing-secret/);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.changed, false);
  assert.equal(body.env.MEZON_BOT_TOKEN, true);
  assert.equal(await readFile(envFile, "utf8"), "MEZON_BOT_TOKEN=existing-secret\nMEZON_HOST=gw.mezon.ai\n");
});

test("configure_mezon_env rejects invalid optional values before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserbridge-mezon-env-"));
  const envFile = join(dir, ".env");
  await writeFile(envFile, "MEZON_BOT_TOKEN=existing-secret\n");

  const result = await runCLI([
    "--dry-run",
    "--target-env-file", envFile,
    "--bot-id", "bot",
    "--channel", "channel",
    "--admin", "admin",
    "--port", "70000",
    "--use-ssl", "flase",
  ]);

  assert.equal(result.code, 1);
  assert.doesNotMatch(result.stdout, /existing-secret/);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.deepEqual(body.errors, [
    "MEZON_PORT must be a valid port",
    "MEZON_USE_SSL must be a boolean",
  ]);
});

test("configure_mezon_env writes quoted values without exposing token in output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browserbridge-mezon-env-"));
  const envFile = join(dir, ".env");

  const result = await runCLI([
    "--target-env-file", envFile,
    "--bot-id", "bot",
    "--token", "secret with spaces",
    "--channel", "channel",
    "--admin", "admin",
    "--port", "443",
    "--use-ssl", "true",
  ]);

  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /secret with spaces/);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.changed, true);
  const text = await readFile(envFile, "utf8");
  assert.match(text, /MEZON_BOT_TOKEN='secret with spaces'/);
});

function runCLI(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repoRoot,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
