#!/bin/bash
# P3 冒烟测试场景 4-7(会话 + 流式 + Team/Project 组织隔离头)
BFF=http://localhost:9390
AUTH="Authorization: Bearer test"
TENANT="X-Tenant-Id: tenant-enterprise"
USER="X-User-Id: user-1"

echo "=== 场景4: 企业版会话创建(POST /agents/:agentId/sessions) ==="
SESSION_RESP=$(curl -s -X POST $BFF/agents/coder-agent/sessions \
  -H "$AUTH" -H "$TENANT" -H "$USER" \
  -H "Content-Type: application/json" \
  -d '{"title":"冒烟测试会话"}')
echo "$SESSION_RESP" | python3 -m json.tool 2>/dev/null
SESSION_ID=$(echo "$SESSION_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
echo "提取 sessionId=$SESSION_ID"
echo ""

echo "=== 场景4b: 获取会话详情(GET /agents/:agentId/sessions/:sessionId) ==="
curl -s $BFF/agents/coder-agent/sessions/$SESSION_ID -H "$AUTH" -H "$TENANT" -H "$USER" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== 场景5: 会话列表(GET /agents/:agentId/sessions) ==="
curl -s $BFF/agents/coder-agent/sessions -H "$AUTH" -H "$TENANT" -H "$USER" | python3 -m json.tool 2>/dev/null | head -20
echo ""

echo "=== 场景6: 流式对话(POST /agents/chat/completions) ==="
echo "发送消息,SSE 流应包含 reasoning/delta/usage/done chunks:"
curl -s -N -X POST $BFF/agents/chat/completions \
  -H "$AUTH" -H "$TENANT" -H "$USER" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"content\":\"你好\",\"agent_id\":\"coder-agent\"}" 2>/dev/null | head -30
echo ""
echo "=== 场景6 完成 ==="
