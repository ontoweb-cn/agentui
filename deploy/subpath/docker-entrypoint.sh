#!/bin/sh
set -e

# =============================================================================
# 子目录部署 entrypoint(方案 A)
# 与根 docker-entrypoint.sh 的差异:
#   1. 新增 SUBPATH/WARGAME_HOST/WARGAME_PORT 环境变量(注入 Nginx 配置)
#   2. BFF_OAUTH_FRONTEND_HOME 默认值改为 /${SUBPATH}/
# =============================================================================

# 子目录名(必须与构建时 --build-arg SUBPATH 一致,不带前后斜杠)
export SUBPATH="${SUBPATH:-agentui}"

# 后端地址
export INTELLECT_RAG_HOST="${INTELLECT_RAG_HOST:-intellect-rag}"
export PYTHON_API_PORT="${PYTHON_API_PORT:-9380}"
export PYTHON_ADMIN_PORT="${PYTHON_ADMIN_PORT:-9381}"
export BFF_PORT="${BFF_PORT:-9390}"

# cognitive-wargame 后端
export WARGAME_HOST="${WARGAME_HOST:-${INTELLECT_RAG_HOST}}"
export WARGAME_PORT="${WARGAME_PORT:-9385}"

# OAuth 回调默认重定向到子目录首页
export BFF_OAUTH_FRONTEND_HOME="${BFF_OAUTH_FRONTEND_HOME:-/${SUBPATH}/}"

# 注入 Nginx 配置
envsubst '${SUBPATH} ${INTELLECT_RAG_HOST} ${PYTHON_API_PORT} ${PYTHON_ADMIN_PORT} ${BFF_PORT} ${WARGAME_HOST} ${WARGAME_PORT}' \
  < /etc/nginx/http.d/default.conf.template \
  > /etc/nginx/http.d/default.conf

# 启动 BFF(后台)
cd /app/bff && node dist/index.mjs &

# 启动 Nginx(前台)
exec nginx -g 'daemon off;'
