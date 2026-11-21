#!/usr/bin/env bash
# Dawn Company — the dev table: game server + Vite (hot reload) in one terminal.
# If either is already up (from this repo), it is stood down and restarted.
# Ctrl+C stops both.
#
# Usage: ./dev.sh [server args, e.g. --timer 0]
#   DS_PORT=8081       game server port
#   DS_VITE_PORT=5199  Vite port (the one you open)
#   DS_KIT=diorama     kit in the printed links ("" for the default)
set -uo pipefail
cd "$(dirname "$0")"
here=$(pwd -P)

SERVER_PORT=${DS_PORT:-8081}
VITE_PORT=${DS_VITE_PORT:-5199}
KIT=${DS_KIT-diorama}

amber=$'\e[38;5;214m'; khaki=$'\e[38;5;180m'; moss=$'\e[38;5;108m'; rust=$'\e[38;5;131m'
dim=$'\e[2m'; off=$'\e[0m'
say()  { printf '%s%s%s  %s\n' "$dim" "$(date +%H:%M:%S)" "$off" "$*"; }
ok()   { say "${khaki}$*${off}"; }
warn() { say "${rust}$*${off}"; }
fail() { warn "$*"; exit 1; }

printf '%s' "$amber"
cat <<'BANNER'

   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
        D A W N   C O M P A N Y
        mist on the fields. stand to.
   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·

BANNER
printf '%s' "$off"

command -v node >/dev/null || fail "No node on this machine. Nothing moves without it."
if [ ! -d node_modules ]; then
  say "Kit not issued. Drawing stores..."
  npm install --no-fund --no-audit >/dev/null || fail "Stores came up short. Run 'npm install' and read what it says."
fi

# ---- clear the ground: stand down whatever of ours holds a port

holders() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u; }
ours()    { [ "$(readlink -f "/proc/$1/cwd" 2>/dev/null)" = "$here" ]; }

clear_port() {  # port, name
  local pids pid
  pids=$(holders "$1")
  [ -z "$pids" ] && return 0
  for pid in $pids; do
    ours "$pid" || fail "Port $1 is held by something else (pid $pid: $(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-80)). Pick another with DS_PORT / DS_VITE_PORT."
  done
  say "$2 already up on $1. Standing it down..."
  kill $pids 2>/dev/null
  for _ in $(seq 50); do [ -z "$(holders "$1")" ] && { ok "$2 stood down."; return 0; }; sleep 0.1; done
  kill -9 $(holders "$1") 2>/dev/null; sleep 0.3
  [ -z "$(holders "$1")" ] || fail "$2 on $1 won't stand down."
  ok "$2 stood down (the hard way)."
}

clear_port "$SERVER_PORT" "Radio"
clear_port "$VITE_PORT" "Map table"

# ---- the two voices, tagged

tag() {  # name, colour
  local name=$1 colour=$2 line
  while IFS= read -r line; do
    line=${line%$'\r'}
    case $line in
      ''|'Players open:'|'  http://'*|*'➜'*|*[█▄▀]*) continue ;;   # the links and QR below replace these
    esac
    line=$(sed -E 's/^[0-9]{1,2}:[0-9]{2}:[0-9]{2} [AP]M //; s/^\[vite\] //; s/^\(client\) //' <<<"$line")
    case $line in
      *rror*|*ERR*|*uncaught*|*unhandled*|*'already in use'*) line="${rust}${line}${off}" ;;
      'Match log: '*) line="${moss}new match on the books: ${line#Match log: $here/}${off}" ;;
      'page reload '*) line="${dim}fresh orders: ${line#page reload }${off}" ;;
      'hmr update '*) line="${dim}touched up: ${line#hmr update }${off}" ;;
    esac
    printf '%s%s%s  %s%-5s%s │ %s\n' "$dim" "$(date +%H:%M:%S)" "$off" "$colour" "$name" "$off" "$line"
  done
}

say "Radio warming up on $SERVER_PORT..."
node_modules/.bin/tsx src/server/main.ts --port "$SERVER_PORT" "$@" > >(tag radio "$khaki") 2>&1 &
spid=$!

say "Laying out the map table on $VITE_PORT..."
DS_SERVER_PORT=$SERVER_PORT node_modules/.bin/vite --port "$VITE_PORT" --strictPort --clearScreen false \
  > >(tag map "$moss") 2>&1 &
vpid=$!

stop() {
  trap - INT TERM EXIT
  echo
  say "Striking camp..."
  kill "$spid" "$vpid" 2>/dev/null
  wait "$spid" "$vpid" 2>/dev/null
  ok "Fires out. Gone before the light."
  exit 0
}
trap stop INT TERM EXIT

# ---- wait for both, then hand out the links

for _ in $(seq 150); do
  [ -n "$(holders "$SERVER_PORT")" ] && [ -n "$(holders "$VITE_PORT")" ] && break
  kill -0 "$spid" 2>/dev/null && kill -0 "$vpid" 2>/dev/null || break
  sleep 0.1
done
if [ -n "$(holders "$SERVER_PORT")" ] && [ -n "$(holders "$VITE_PORT")" ]; then
  q=${KIT:+?kit=$KIT}
  lan=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo
  ok "Stand to. The table is set."
  say "  this machine  ${amber}http://localhost:$VITE_PORT/$q${off}"
  say "  all seats     ${amber}http://localhost:$VITE_PORT/dev.html$q${off}"
  if [ -n "$lan" ]; then
    say "  phones        ${amber}http://$lan:$VITE_PORT/$q${off}"
    node -e "require('qrcode-terminal').generate(process.argv[1], { small: true })" "http://$lan:$VITE_PORT/$q" 2>/dev/null
  fi
  say "${dim}Ctrl+C strikes camp.${off}"
  echo
fi

wait -n "$spid" "$vpid"
kill -0 "$spid" 2>/dev/null || warn "The radio's gone quiet (server stopped)."
kill -0 "$vpid" 2>/dev/null || warn "The map table's gone over (Vite stopped)."
