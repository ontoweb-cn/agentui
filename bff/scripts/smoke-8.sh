#!/bin/bash
# P3 冒烟测试场景 8(错误处理)
BFF=http://localhost:9390
AUTH="Authorization: Bearer test"

echo "=== 场景8a: 缺失 X-Tenant-Id → 400 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" $BFF/capabilities -H "$AUTH" -H "X-User-Id: user-1"
curl -s $BFF/capabilities -H "$AUTH" -H "X-User-Id: user-1" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== 场景8b: tenant 不存在 → 404 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" $BFF/capabilities -H "$AUTH" -H "X-Tenant-Id: nonexistent" -H "X-User-Id: user-1"
curl -s $BFF/capabilities -H "$AUTH" -H "X-Tenant-Id: nonexistent" -H "X-User-Id: user-1" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== 场景8c: 缺失 Authorization → 401 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" $BFF/capabilities -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: user-1"
echo ""

echo "=== 场景8d: 会话不存在 → 502(Adapter 错误) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" $BFF/agents/coder-agent/sessions/nonexistent-sess -H "$AUTH" -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: user-1"
curl -s $BFF/agents/coder-agent/sessions/nonexistent-sess -H "$AUTH" -H "X-Tenant-Id: tenant-enterprise" -H "X-User-Id: user-1" 2>/dev/null | head -c 200
echo ""
