#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/server/.env"
OLD_DEFAULT_DATABASE_URL="postgres://browserbridge:browserbridge@127.0.0.1:5432/browserbridge?sslmode=disable"
DEFAULT_DATABASE_URL="postgres://browserbridge:browserbridge@127.0.0.1:55432/browserbridge?sslmode=disable"

mkdir -p "$ROOT_DIR/server"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

node - "$ENV_FILE" "$DEFAULT_DATABASE_URL" "$OLD_DEFAULT_DATABASE_URL" <<'NODE'
const fs = require("fs");
const [envPath, databaseUrl, oldDatabaseUrl] = process.argv.slice(2);
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (/^DATABASE_URL=/m.test(text)) {
  text = text.replace(/^DATABASE_URL=.*$/m, (line) => {
    const value = line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
    return value && value !== oldDatabaseUrl ? line : `DATABASE_URL=${databaseUrl}`;
  });
} else {
  if (text && !text.endsWith("\n")) text += "\n";
  text += `DATABASE_URL=${databaseUrl}\n`;
}
fs.writeFileSync(envPath, text);
NODE

cd "$ROOT_DIR"
docker compose up -d postgres

for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U browserbridge -d browserbridge >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

node tools/migrate_db.mjs
