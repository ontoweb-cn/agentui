#!/bin/bash
# P3 冒烟测试场景 1-3(BFF 直连,路径无 /api/bff 前缀 — Vite rewrite 模拟)
BFF=http://localhost:9390
AUTH="Authorization: Bearer test"

echo "=== 场景1: Admin 列出后端(含企业版) ==="
curl -s $BFF/admin/harness-backends -H "$AUTH" | python3 -m json.tool 2>/dev/null | head -45
echo ""

echo "=== 场景2: 企业版 tenant 能力探测(canvas=false, multiTenant=true) ==="
curl -s $BFF/capabilities -H "$AUTH" -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: user-1" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== 场景2b: RAG tenant 能力探测(canvas=true) ==="
curl -s $BFF/capabilities -H "$AUTH" -H "X-Tenant-Id: tenant-rag" -H "X-User-Id: user-1" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== 场景3: 企业版 Agent 列表(经 Adapter 调 mock /v1/models) ==="
curl -s $BFF/agents -H "$AUTH" -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: user-1" | python3 -m json.tool 2>/dev/null
