#!/usr/bin/env bash
# 로컬 개발: server(:8080)와 web(:5173)을 함께 띄운다. Ctrl+C 로 둘 다 끈다.
# 화면의 /api 요청은 vite 프록시가 server 로 넘긴다.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d server/node_modules ] || npm --prefix server ci
[ -d web/node_modules ] || npm --prefix web ci
export DATA_DIR="${DATA_DIR:-$PWD/server/data}"
port="${PORT:-8080}"
echo "server: http://localhost:$port  DATA_DIR=$DATA_DIR"
PORT="$port" npm --prefix server run dev &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
API_PROXY_TARGET="http://localhost:$port" npm --prefix web run dev -- --host
