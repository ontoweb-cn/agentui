#!/usr/bin/env bash
# 运行时插件打包(#2b 部署形态·方案 B):
# 从 cognitive-wargame 仓库检出指定 ref,构建插件产物,放入 agentui 构建上下文
# 的 deploy/plugin-bundles/<id>/(.gitignore 忽略),随 `docker build` 烤进镜像。
#
# 用法:
#   scripts/package-plugin-bundle.sh                     # 默认:相邻路径 ../cognitive-wargame @ 当前 HEAD
#   scripts/package-plugin-bundle.sh --ref v1.2.0        # 指定 tag/commit/分支
#   scripts/package-plugin-bundle.sh --repo git@...:x/cognitive-wargame.git --ref main
#
# 前置:node 20+ / npm;git(使用 --repo 时)。
# 产物:deploy/plugin-bundles/<id>/{app.json, ui/}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTUI_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLES_DIR="${AGENTUI_ROOT}/deploy/plugin-bundles"

REPO=""
REF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/plugin-bundle-XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

if [[ -n "$REPO" ]]; then
  echo "==> clone $REPO @ ${REF:-HEAD}"
  if [[ -n "$REF" ]]; then
    git clone --depth 1 --branch "$REF" "$REPO" "$WORK_DIR" 2>/dev/null \
      || { git clone "$REPO" "$WORK_DIR" && git -C "$WORK_DIR" checkout "$REF"; }
  else
    git clone "$REPO" "$WORK_DIR"
  fi
  PLUGIN_DIR="$WORK_DIR/web/agentui"
else
  # 默认相邻 checkout(本地开发/发版机两仓库并列)。
  # 拷贝到工作目录再构建:npm ci 会先删除 node_modules——直接在源工程执行
  # 会破坏其符号链接开发布局(../qwenpaw/node_modules)。
  DEFAULT_DIR="${AGENTUI_ROOT}/../cognitive-wargame"
  if [[ ! -d "$DEFAULT_DIR/web/agentui" ]]; then
    echo "✗ 未找到相邻插件仓库: $DEFAULT_DIR(或用 --repo 指定)" >&2
    exit 1
  fi
  if [[ -n "$REF" ]]; then
    echo "==> 本地仓库检出 ref: $REF"
    git -C "$DEFAULT_DIR" fetch --all --quiet || true
    git -C "$DEFAULT_DIR" worktree add --detach "$WORK_DIR" "$REF"
    # rm -rf 工作目录后清理源仓库的 worktree 残留记录(评审 L1)
    trap 'rm -rf "$WORK_DIR" && git -C "$DEFAULT_DIR" worktree prune >/dev/null 2>&1 || true' EXIT
    PLUGIN_DIR="$WORK_DIR/web/agentui"
  else
    echo "==> 拷贝本地插件工程到临时目录(不动源 checkout)"
    rsync -a --exclude node_modules --exclude ui/dist --exclude .vite-cache \
      "$DEFAULT_DIR/web/agentui/" "$WORK_DIR/web/agentui/"
    PLUGIN_DIR="$WORK_DIR/web/agentui"
  fi
fi

if [[ ! -f "$PLUGIN_DIR/app.json" ]]; then
  echo "✗ 未找到插件工程(app.json 缺失): $PLUGIN_DIR" >&2
  exit 1
fi

echo "==> 安装依赖并构建($PLUGIN_DIR)"
cd "$PLUGIN_DIR"
npm ci --no-audit --no-fund
npm run build   # 含 lint:imports + tsc + build:locales + vite build

PLUGIN_ID="$(node -e "console.log(require('./app.json').id)")"
# id 参与拼接 rm -rf 目标路径,必须先过白名单(与 BFF 侧规则对齐),
# 阻断恶意 app.json id(如 ../../)的路径注入(评审 M1)
if ! [[ "$PLUGIN_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "✗ app.json 的 id 含非法字符(只允许字母数字/._-): $PLUGIN_ID" >&2
  exit 1
fi
OUT_DIR="$BUNDLES_DIR/$PLUGIN_ID"
echo "==> 产物输出: $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp app.json "$OUT_DIR/app.json"
cp -R ui "$OUT_DIR/ui"

echo "✓ 插件 bundle 就绪: $OUT_DIR"
echo "  下一步: docker build -t <registry>/agentui:<tag> .(bundle 随镜像分发)"
