#!/usr/bin/env bash
# =============================================================================
# 写发版元数据（D6 消费侧登记，2026-10-21）
#
# 形成「宿主镜像 ↔ 插件版本 ↔ 产物摘要」三元可追溯链：构建时把本次消费的
# bundle 来源、sha256/digest、插件版本与宿主 commit 写入
# deploy/release-metadata.json，随镜像/归档留存，便于回溯与回滚核对。
#
# 用法：
#   scripts/write-release-metadata.sh --source <url|image> --sha256 <hex|digest>
#                                     [--plugin-version 0.3.7] [--image-tag 0.4.0]
#                                     [--out deploy/release-metadata.json]
#
# 幂等：重复执行以最新一次为准；缺参即失败（不写半截文件）。
# =============================================================================
set -euo pipefail

PLUGIN_ID="cognitive-wargame"
SOURCE=""
SHA256=""
PLUGIN_VERSION=""
IMAGE_TAG="${IMAGE_TAG:-}"
OUT="deploy/release-metadata.json"

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --sha256) SHA256="${2:-}"; shift 2 ;;
    --plugin-version) PLUGIN_VERSION="${2:-}"; shift 2 ;;
    --image-tag) IMAGE_TAG="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

[ -n "$SOURCE" ] || { echo "✗ 需要 --source（bundle URL 或镜像引用）" >&2; exit 2; }
[ -n "$SHA256" ] || { echo "✗ 需要 --sha256（tarball sha256 或镜像 digest）" >&2; exit 2; }
[ -n "$IMAGE_TAG" ] || IMAGE_TAG="$(git describe --tags --always 2>/dev/null || echo unknown)"

# 插件版本：优先参数，其次从已解包的 app.json 读取
if [ -z "$PLUGIN_VERSION" ] && [ -f "deploy/plugin-bundles/$PLUGIN_ID/app.json" ]; then
  PLUGIN_VERSION="$(node -e "const j=require('./deploy/plugin-bundles/$PLUGIN_ID/app.json');process.stdout.write(String(j.version||''))")"
fi
[ -n "$PLUGIN_VERSION" ] || PLUGIN_VERSION="unknown"

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$(dirname "$OUT")"
OUT="$OUT" SOURCE="$SOURCE" SHA256="$SHA256" PLUGIN_ID="$PLUGIN_ID" \
PLUGIN_VERSION="$PLUGIN_VERSION" IMAGE_TAG="$IMAGE_TAG" COMMIT="$COMMIT" \
GENERATED_AT="$GENERATED_AT" node -e '
const fs = require("fs");
const env = process.env;
const payload = {
  generated_at: env.GENERATED_AT,
  agentui: { commit: env.COMMIT, image_tag: env.IMAGE_TAG },
  plugin: {
    id: env.PLUGIN_ID,
    version: env.PLUGIN_VERSION,
    source: env.SOURCE,
    sha256: env.SHA256,
  },
};
fs.writeFileSync(env.OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log("✓ 发版元数据:", env.OUT);
console.log("  plugin:", payload.plugin.version, payload.plugin.sha256);
'
