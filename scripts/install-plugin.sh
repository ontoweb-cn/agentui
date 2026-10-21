#!/bin/sh
# 本地开发:把插件目录经 BFF local 通道安装(canvas-stage4 spec §9.2)。
# 用法: scripts/install-plugin.sh [sourceDir] [bffBase]
# 缺省 sourceDir = 仓库内已装配的 canvas 插件(deploy/plugin-bundles/canvas,
# 先跑 npm run build:canvas-plugin 生成);token 取 env 或 bff/.env。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/deploy/plugin-bundles/canvas}"
BFF="${2:-http://127.0.0.1:9390}"

if [ ! -f "$SRC/app.json" ]; then
  echo "source 目录缺少 app.json: $SRC(先跑 npm run build:canvas-plugin?)" >&2
  exit 1
fi

if [ -z "${BFF_PLUGIN_INSTALL_TOKEN:-}" ] && [ -f "$ROOT/bff/.env" ]; then
  BFF_PLUGIN_INSTALL_TOKEN=$(grep -E '^BFF_PLUGIN_INSTALL_TOKEN=' "$ROOT/bff/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export BFF_PLUGIN_INSTALL_TOKEN
fi
if [ -z "${BFF_PLUGIN_INSTALL_TOKEN:-}" ]; then
  echo "缺 BFF_PLUGIN_INSTALL_TOKEN(env 或 bff/.env)" >&2
  exit 1
fi

echo "安装 $SRC → $BFF"
curl -sf -X POST "$BFF/plugins/install" \
  -H "X-Plugin-Admin-Token: $BFF_PLUGIN_INSTALL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"source\": \"$SRC\"}"
echo ""
