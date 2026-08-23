import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const requiredFiles = [
  "manifest.json",
  "background.js",
  "protocol.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
];

const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const protocol = await readFile(new URL("../extension/protocol.js", import.meta.url), "utf8");
const zipPath = new URL("../dist/browser-bridge-extension.zip", import.meta.url);
const report = {
  ok: true,
  manifest: {
    manifestVersion: manifest.manifest_version,
    name: manifest.name,
    version: manifest.version,
    background: manifest.background?.service_worker || "",
    optionsPage: manifest.options_page || "",
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || [],
  },
  protocol: {
    defaultServerUrl: extractDefaultServerURL(protocol),
    capabilities: extractCapabilities(protocol),
  },
  files: {},
  zip: null,
  errors: [],
};

for (const file of requiredFiles) {
  const url = new URL(`../extension/${file}`, import.meta.url);
  try {
    const bytes = await readFile(url);
    report.files[file] = {
      present: true,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    report.ok = false;
    report.files[file] = { present: false };
    report.errors.push(`missing extension/${file}`);
  }
}

validateManifest();
await checkZip();

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function validateManifest() {
  if (manifest.manifest_version !== 3) error("manifest_version must be 3");
  if (manifest.background?.service_worker !== "background.js") error("background service worker must be background.js");
  if (manifest.background?.type !== "module") error("background service worker must be type module");
  for (const permission of ["storage", "tabs", "scripting"]) {
    if (!manifest.permissions?.includes(permission)) error(`missing permission ${permission}`);
  }
  if (!manifest.host_permissions?.includes("<all_urls>")) error("missing <all_urls> host permission");
  if (report.protocol.defaultServerUrl !== "ws://127.0.0.1:8788/v1/extension") error("default server URL must use local 8788 WSS path");
  for (const capability of ["tabs.list", "tabs.open", "tabs.close", "runtime.evaluate", "media.uploadToDrive"]) {
    if (!report.protocol.capabilities.includes(capability)) error(`missing capability ${capability}`);
  }
}

async function checkZip() {
  try {
    const zipStat = await stat(zipPath);
    const entries = await unzipList(zipPath.pathname);
    report.zip = {
      present: true,
      size: zipStat.size,
      entries,
      hasRequiredFiles: requiredFiles.every((file) => entries.includes(`extension/${file}`) || entries.includes(file)),
      hashesMatchSource: true,
    };
    if (!report.zip.hasRequiredFiles) error("zip is missing required extension files");
    for (const file of requiredFiles) {
      const entry = entries.includes(`extension/${file}`) ? `extension/${file}` : file;
      if (!entries.includes(entry)) continue;
      const bytes = await unzipEntry(zipPath.pathname, entry);
      const zipHash = createHash("sha256").update(bytes).digest("hex");
      if (zipHash !== report.files[file]?.sha256) {
        report.zip.hashesMatchSource = false;
        error(`zip entry ${entry} does not match extension/${file}`);
      }
    }
  } catch (zipError) {
    report.zip = { present: false, error: String(zipError?.message || zipError) };
  }
}

function unzipList(path) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-Z1", path], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.split(/\r?\n/).filter(Boolean));
      else reject(new Error(stderr || `unzip exited ${code}`));
    });
  });
}

function unzipEntry(path, entry) {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", path, entry], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => { chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(stderr || `unzip entry exited ${code}`));
    });
  });
}

function error(message) {
  report.ok = false;
  report.errors.push(message);
}

function extractDefaultServerURL(text) {
  return text.match(/serverUrl:\s*"([^"]+)"/)?.[1] || "";
}

function extractCapabilities(text) {
  const match = text.match(/capabilities\s*=\s*\[([^\]]*)\]/s);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}
