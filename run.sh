#!/usr/bin/env bash
# Dawn Company — build the client and host a match on this machine.
# Usage: ./run.sh [--port 8080] [--timer 90] [--resume matches/<file>.jsonl]
# Any arguments are passed straight to the server.
set -euo pipefail
cd "$(dirname "$0")"

amber=$'\e[38;5;214m'; khaki=$'\e[38;5;180m'; rust=$'\e[38;5;131m'; dim=$'\e[2m'; off=$'\e[0m'
say()  { printf '%s%s%s  %s\n' "$dim" "$(date +%H%M)" "$off" "$*"; }
ok()   { say "${khaki}$*${off}"; }
fail() { say "${rust}$*${off}"; exit 1; }

printf '%s' "$amber"
cat <<'BANNER'

   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
        D A W N   C O M P A N Y
        first light. stand to.
   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·

BANNER
printf '%s' "$off"

command -v node >/dev/null || fail "No node on this machine. Nothing moves without it."

if [ ! -d node_modules ]; then
  say "Kit not issued. Drawing stores..."
  npm install --no-fund --no-audit >/dev/null || fail "Stores came up short. Run 'npm install' and read what it says."
  ok "Kit issued."
else
  ok "Kit checked."
fi

say "Unrolling the map..."
if npx vite build --logLevel error >/dev/null; then
  ok "Map table set."
else
  fail "The map would not lie flat. Run 'npm run build' and read what it says."
fi

say "Kettle's on. Radio warming up..."
ok "Share the address below. Ctrl+C strikes camp."
echo
exec npx tsx src/server/main.ts "$@"
