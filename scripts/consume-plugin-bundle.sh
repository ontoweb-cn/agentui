#!/usr/bin/env bash
# =============================================================================
# 消费 wargame 插件 bundle tarball（D2 载体切换，2026-10-21）
#
# 背景：cognitive-wargame 的 bundle 已改为 tarball artifact（
# <plugin>-plugin-<version>.tar.gz + .sha256）。本脚本取代
# 「docker pull + create/cp」两跳解包：
#
#   curl -fsSL <url> -o tmp.tar.gz
#   sha256sum -c <sha256>
#   tar -xzf tmp.tar.gz -C deploy/plugin-bundles/<id>/
#
# 用法：
#   scripts/consume-plugin-bundle.sh --url <tarball-url> [--sha256 <hex>]
#                                    [--dest deploy/plugin-bundles] [--plugin cognitive-wargame]
#   scripts/consume-plugin-bundle.sh --file <local.tar.gz> [--sha256 <hex>]
#
# 校验：SHA256 必填（--sha256 或同目录 .sha256 侧车文件）→ 解包到临时目录 →
# 校验 app.json 与 entry 产物存在 → 原子换入目标目录。
# 失败即非零退出，不残留半成品。
# =============================================================================
set -euo pipefail

PLUGIN_ID="cognitive-wargame"
DEST="deploy/plugin-bundles"
URL=""
FILE=""
SHA256=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --sha256) SHA256="${2:-}"; shift 2 ;;
    --dest) DEST="${2:-}"; shift 2 ;;
    --plugin) PLUGIN_ID="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$URL" ] && [ -z "$FILE" ]; then
  echo "✗ 需要 --url 或 --file" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TARBALL="$WORK/bundle.tar.gz"

if [ -n "$URL" ]; then
  case "$URL" in
    https://*|http://127.0.0.1*|http://localhost*) ;;
    *) echo "✗ 仅允许 https（或本地回环 http）: $URL" >&2; exit 2 ;;
  esac
  echo "==> 下载 $URL"
  curl -fsSL --retry 3 --connect-timeout 10 "$URL" -o "$TARBALL"
else
  echo "==> 使用本地包 $FILE"
  cp "$FILE" "$TARBALL"
fi

# sha256：参数优先，其次同目录侧车文件（下载源旁 .sha256）
if [ -z "$SHA256" ] && [ -n "$URL" ]; then
  if curl -fsSL --connect-timeout 10 "${URL}.sha256" -o "$WORK/bundle.sha256" 2>/dev/null; then
    SHA256="$(cut -d' ' -f1 "$WORK/bundle.sha256")"
  fi
fi
if [ -z "$SHA256" ]; then
  echo "✗ 缺少 SHA256：传 --sha256，或提供 <url>.sha256 侧车文件" >&2
  exit 2
fi
if ! [[ "$SHA256" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "✗ SHA256 格式非法" >&2
  exit 2
fi

ACTUAL="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "✗ SHA256 不匹配" >&2
  echo "  expected: $SHA256" >&2
  echo "  actual  : $ACTUAL" >&2
  exit 1
fi
echo "✓ SHA256 校验通过"

mkdir -p "$WORK/unpack"
tar -xzf "$TARBALL" -C "$WORK/unpack"

SRC="$WORK/unpack/$PLUGIN_ID"
if [ ! -d "$SRC" ] && [ -d "$WORK/unpack/opt/bundled-plugins/$PLUGIN_ID" ]; then
  SRC="$WORK/unpack/opt/bundled-plugins/$PLUGIN_ID"
fi
[ -d "$SRC" ] || { echo "✗ 包内未找到插件目录 $PLUGIN_ID" >&2; exit 1; }
[ -f "$SRC/app.json" ] || { echo "✗ 缺少 app.json" >&2; exit 1; }

ENTRY="$(node -e "const j=require('$SRC/app.json');process.stdout.write(j.entry||'')")"
[ -n "$ENTRY" ] || { echo "✗ app.json 缺 entry" >&2; exit 1; }
[ -f "$SRC/$ENTRY" ] || { echo "✗ entry 产物不存在: $SRC/$ENTRY" >&2; exit 1; }

mkdir -p "$DEST"
STAGING="$DEST/.staging-$PLUGIN_ID"
rm -rf "$STAGING"
cp -R "$SRC" "$STAGING"
rm -rf "$DEST/$PLUGIN_ID"
mv "$STAGING" "$DEST/$PLUGIN_ID"

echo "✓ bundle 已就位: $DEST/${PLUGIN_ID}（sha256=${SHA256}）"
