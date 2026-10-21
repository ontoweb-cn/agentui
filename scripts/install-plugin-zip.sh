#!/bin/sh
# 运维/开发:把插件 zip 制品经 BFF zip 上传通道安装(方案 C 前置通道,
# 2026-10-21 起默认启用;BFF_PLUGIN_INSTALL_SOURCES=local 可收回)。
# 用法: scripts/install-plugin-zip.sh <plugin.zip> [bffBase]
# zip 内需含 app.json(根目录或唯一单层子目录,GitHub 式前缀自动剥离);
# token 取 env 或 bff/.env;自动计算 sha256 经 X-Plugin-Archive-Sha256
# 随行下发,BFF 侧与实际制品比对,不匹配即 400(端到端校验)。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="${1:?用法: install-plugin-zip.sh <plugin.zip> [bffBase]}"
BFF="${2:-http://127.0.0.1:9390}"

[ -f "$ZIP" ] || { echo "zip 不存在: $ZIP" >&2; exit 1; }

if [ -z "${BFF_PLUGIN_INSTALL_TOKEN:-}" ] && [ -f "$ROOT/bff/.env" ]; then
  BFF_PLUGIN_INSTALL_TOKEN=$(grep -E '^BFF_PLUGIN_INSTALL_TOKEN=' "$ROOT/bff/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export BFF_PLUGIN_INSTALL_TOKEN
fi
if [ -z "${BFF_PLUGIN_INSTALL_TOKEN:-}" ]; then
  echo "缺 BFF_PLUGIN_INSTALL_TOKEN(env 或 bff/.env)" >&2
  exit 1
fi

SHA256="$(sha256sum "$ZIP" | cut -d' ' -f1)"

echo "上传 $ZIP → $BFF(sha256=$SHA256)"
curl -sf -X POST "$BFF/plugins/install" \
  -H "X-Plugin-Admin-Token: ${BFF_PLUGIN_INSTALL_TOKEN}" \
  -H "X-Plugin-Archive-Sha256: ${SHA256}" \
  -F "file=@${ZIP}"
echo ""
