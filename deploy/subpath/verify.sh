#!/bin/bash
# =============================================================================
# 部署后验证脚本
#
# 用法:
#   ./deploy/subpath/verify.sh agentui example.com
# =============================================================================

set -e

SUBPATH="${1:-agentui}"
HOST="${2:-localhost}"

BASE="https://${HOST}"
SUB="${BASE}/${SUBPATH}/"

echo "===== 1. 前端 SPA 入口 ====="
curl -sI "${SUB}" | head -5
echo ""

echo "===== 2. conf.json(子目录下) ====="
curl -sI "${BASE}/${SUBPATH}/conf.json" | head -3
echo ""

echo "===== 3. 静态资源(logo) ====="
curl -sI "${BASE}/${SUBPATH}/logo-96.png" | head -3
echo ""

echo "===== 4. BFF API(根路径 /api/bff/) ====="
curl -sI "${BASE}/api/bff/admin/wizard/status" | head -3
echo ""

echo "===== 5. cognitive-wargame API ====="
curl -sI "${BASE}/api/v1/wargame/scenarios" | head -3
echo ""

echo "===== 6. intellect-rag API(catch-all) ====="
curl -sI "${BASE}/api/v1/models" | head -3
echo ""

echo "===== 7. SPA 路由回退(任意路径应返回 index.html) ====="
curl -sI "${SUB}login" | head -3
echo ""

echo "===== 8. 根路径重定向 ====="
curl -sI "${BASE}/" | head -3
echo ""

echo "验证完成。如所有请求返回 200/301,子目录部署成功。"
