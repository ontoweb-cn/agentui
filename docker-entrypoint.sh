#!/bin/sh
set -e

# Inject backend address into Nginx config via envsubst
export INTELLECT_RAG_HOST="${INTELLECT_RAG_HOST:-intellect-rag}"
export PYTHON_API_PORT="${PYTHON_API_PORT:-9380}"
export PYTHON_ADMIN_PORT="${PYTHON_ADMIN_PORT:-9381}"
export BFF_PORT="${BFF_PORT:-9390}"
export INTELLECT_RAG_URL="${INTELLECT_RAG_URL:-http://intellect-rag:9380}"
# cognitive-wargame 管理服务(REST 通道,nginx /api/v1/wargame/)
# 修复:此前 envsubst 未替换这两个变量,容器内 nginx 拿到字面量 ${WARGAME_HOST}
export WARGAME_HOST="${WARGAME_HOST:-host.docker.internal}"
export WARGAME_PORT="${WARGAME_PORT:-9385}"
# 网关化拓扑:上游支持全 URL(https + 路径,如 https://ai.wust.edu.cn/wargame/)。
# 未设置时回退原 host:port 组合(默认值严格保持既有行为):
# - WARGAME_UPSTREAM 带路径 /api/v1/(沿用原 proxy_pass 前缀改写语义);
# - RAG_API_UPSTREAM / RAG_ADMIN_UPSTREAM 不带路径(原样透传请求路径)。
export WARGAME_UPSTREAM="${WARGAME_UPSTREAM:-http://${WARGAME_HOST}:${WARGAME_PORT}/api/v1/}"
export RAG_API_UPSTREAM="${RAG_API_UPSTREAM:-http://${INTELLECT_RAG_HOST}:${PYTHON_API_PORT}}"
export RAG_ADMIN_UPSTREAM="${RAG_ADMIN_UPSTREAM:-http://${INTELLECT_RAG_HOST}:${PYTHON_ADMIN_PORT}}"

envsubst '${INTELLECT_RAG_HOST} ${PYTHON_API_PORT} ${PYTHON_ADMIN_PORT} ${BFF_PORT} ${WARGAME_HOST} ${WARGAME_PORT} ${WARGAME_UPSTREAM} ${RAG_API_UPSTREAM} ${RAG_ADMIN_UPSTREAM}' \
  < /etc/nginx/http.d/default.conf.template \
  > /etc/nginx/http.d/default.conf

# Start BFF in background
cd /app/bff && node dist/index.mjs &

# 安装镜像内置的运行时插件 bundle(#2b 方案 B,可选):
# /opt/bundled-plugins/<id>/ 由 scripts/package-plugin-bundle.sh 产出并烤入镜像,
# 容器每次启动幂等重装(镜像版本即插件版本)。
# 失败只告警不阻塞启动——插件是增量功能,宿主与静态页必须照常可用。
install_bundled_plugins() {
  if [ ! -d /opt/bundled-plugins ] || [ -z "$(ls -d /opt/bundled-plugins/*/ 2>/dev/null)" ]; then
    return 0
  fi
  if [ -z "${BFF_PLUGIN_INSTALL_TOKEN:-}" ]; then
    echo "[entrypoint] 检测到内置插件 bundle 但未设置 BFF_PLUGIN_INSTALL_TOKEN,跳过安装" >&2
    return 0
  fi
  # 等待 BFF 就绪(最多 30s)
  i=0
  until wget -q -O /dev/null "http://127.0.0.1:${BFF_PORT}/health" 2>/dev/null; do
    i=$((i+1))
    if [ "$i" -ge 60 ]; then
      echo "[entrypoint] BFF 健康检查超时,跳过插件安装" >&2
      return 0
    fi
    sleep 0.5
  done
  for dir in /opt/bundled-plugins/*/; do
    [ -f "$dir/app.json" ] || continue
    echo "[entrypoint] 安装内置插件: $dir"
    if wget -q -O - --header='Content-Type: application/json' \
         --header="X-Plugin-Admin-Token: ${BFF_PLUGIN_INSTALL_TOKEN}" \
         --post-data="{\"source\": \"${dir%/}\"}" \
         "http://127.0.0.1:${BFF_PORT}/plugins/install"; then
      echo ""
    else
      echo "[entrypoint] ⚠️ 插件安装失败(不影响宿主启动): $dir" >&2
    fi
  done
}
install_bundled_plugins &

# Start Nginx in foreground
exec nginx -g 'daemon off;'
