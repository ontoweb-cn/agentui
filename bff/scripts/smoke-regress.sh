#!/bin/bash
# T027 P0/P1/P2 运行时回归冒烟(验证 P3 改动不破坏既有功能)
BFF=http://localhost:9390
AUTH="Authorization: Bearer test"

echo "=== 回归1: P0 透传路由 /proxy/v1/* 仍可达(401 无 auth) ==="
curl -s -o /dev/null -w "HTTP %{http_code}(期望 401)\n" $BFF/proxy/v1/agents
echo ""

echo "=== 回归2: P2 Admin CRUD - GET 列表(2 后端) ==="
COUNT=$(curl -s $BFF/admin/harness-backends -H "$AUTH" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
echo "后端数量: $COUNT (期望 2)"
echo ""

echo "=== 回归3: P1 capabilities 端点 - RAG tenant 仍返回 RAG 能力 ==="
curl -s $BFF/capabilities -H "$AUTH" -H "X-Tenant-Id: tenant-rag" -H "X-User-Id: u1" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f\"backendType={d['backendType']}, canvas={d['capabilities']['canvas']}\")" 2>/dev/null
echo ""

echo "=== 回归4: P0 health 端点 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" $BFF/health
echo ""

echo "=== 回归5: P2 Admin POST 新增后端(验证 CRUD 写入) ==="
curl -s -X POST $BFF/admin/harness-backends -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"id":"smoke-test-backend","name":"Smoke Test","type":"intellect-enterprise","endpoint":"http://localhost:9999","adminTokenEnvVar":"HARNESS_SMOKE_TEST","capabilities":{"canvas":false,"knowledgeBase":false,"memory":false,"mcp":false,"multiTenant":false,"modelManagement":false}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"create code={d.get('code')}, id={d.get('data',{}).get('id','?')}\")" 2>/dev/null
echo ""

echo "=== 回归6: 清理 - 删除测试后端 ==="
curl -s -X DELETE $BFF/admin/harness-backends/smoke-test-backend -H "$AUTH" -o /dev/null -w "DELETE HTTP %{http_code}\n"
