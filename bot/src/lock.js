import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function acquireSingleHostLock(lockFile) {
  const path = resolve(lockFile);
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    return {
      path,
      async release() {
        await handle.close().catch(() => undefined);
        await rm(path, { force: true }).catch(() => undefined);
      },
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const owner = await readLockOwner(path);
    if (owner.pid && !processIsRunning(owner.pid)) {
      await rm(path, { force: true });
      return acquireSingleHostLock(path);
    }
    const details = owner.pid ? `pid=${owner.pid}` : "unknown owner";
    throw new Error(`another bot instance is already running (${details}); remove ${path} only if it is stale`);
  }
}

async function readLockOwner(path) {
  try {
    const [rawPid = ""] = (await readFile(path, "utf8")).split(/\r?\n/);
    const pid = Number.parseInt(rawPid, 10);
    return { pid: Number.isInteger(pid) && pid > 0 ? pid : 0 };
  } catch {
    return { pid: 0 };
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
