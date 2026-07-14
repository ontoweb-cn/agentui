#!/bin/bash
# AU5: OAuth E2E 冒烟测试(企业版第三方登录)
# 前置:BFF :9390 + mock-intellect-team :8642 已启动
# 覆盖:渠道列表 → 发起跳转(state cookie) → CSRF 防护 → 回调签发 → /auth/me 验证
BFF=http://localhost:9390
COOKIE_JAR=$(mktemp)
HEADER_FILE=$(mktemp)
PASS=0
FAIL=0

assert() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (期望 $expected, 实际 $actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=========================================="
echo "OAuth E2E 冒烟测试"
echo "=========================================="

# ---------------------------------------------------------------------------
# 场景 1: 获取 OAuth 渠道列表
# ---------------------------------------------------------------------------
echo ""
echo "=== 场景 1: GET /auth/login/channels ==="
RESP=$(curl -s $BFF/auth/login/channels -H "X-Tenant-Id: tenant-enterprise")
COUNT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null)
echo "  渠道数量: $COUNT"
if [ "$COUNT" -ge 1 ] 2>/dev/null; then
  echo "  PASS: 至少 1 个渠道"
  PASS=$((PASS + 1))
else
  echo "  FAIL: 无渠道返回"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# 场景 2: 发起 OAuth 跳转(捕获 state cookie + 302)
# ---------------------------------------------------------------------------
echo ""
echo "=== 场景 2: GET /auth/login/github (发起跳转) ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -c "$COOKIE_JAR" -D "$HEADER_FILE" \
  "$BFF/auth/login/github" -H "X-Tenant-Id: tenant-enterprise")
assert "302 重定向" "302" "$HTTP_CODE"

STATE=$(grep oauth_state "$COOKIE_JAR" | awk '{print $NF}')
if [ -n "$STATE" ]; then
  echo "  PASS: oauth_state cookie 已设置 (state=$STATE)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: oauth_state cookie 未设置"
  FAIL=$((FAIL + 1))
fi

LOCATION=$(grep -i "^location:" "$HEADER_FILE" | head -1 | tr -d '\r' | awk '{print $2}')
echo "  Location: ${LOCATION:0:80}..."

# ---------------------------------------------------------------------------
# 场景 3: CSRF 防护 — state 不匹配 → 400
# ---------------------------------------------------------------------------
echo ""
echo "=== 场景 3: CSRF 防护 (state 不匹配) ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -b "oauth_state=wrongstate" \
  "$BFF/auth/oauth/callback?code=fake&state=differentstate" -H "X-Tenant-Id: tenant-enterprise")
assert "state 不匹配 → 400" "400" "$HTTP_CODE"

# ---------------------------------------------------------------------------
# 场景 4: 完整 OAuth 回调(state 匹配 → 302 + imt_token)
# ---------------------------------------------------------------------------
echo ""
echo "=== 场景 4: GET /auth/oauth/callback (state 匹配) ==="
if [ -n "$STATE" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    "$BFF/auth/oauth/callback?code=mock-code&state=$STATE" -H "X-Tenant-Id: tenant-enterprise")
  assert "回调成功 → 302" "302" "$HTTP_CODE"

  if grep -q imt_token "$COOKIE_JAR"; then
    echo "  PASS: imt_token cookie 已设置"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: imt_token cookie 未设置"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  SKIP: 未获取到 state cookie,跳过回调测试"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# 场景 5: 验证 OAuth 登录后 /auth/me 可用
# ---------------------------------------------------------------------------
echo ""
echo "=== 场景 5: GET /auth/me (验证 OAuth 登录态) ==="
if grep -q imt_token "$COOKIE_JAR"; then
  RESP=$(curl -s "$BFF/auth/me" -b "$COOKIE_JAR" -H "X-Tenant-Id: tenant-enterprise")
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BFF/auth/me" -b "$COOKIE_JAR" -H "X-Tenant-Id: tenant-enterprise")
  assert "/auth/me → 200" "200" "$HTTP_CODE"

  MEMBER_ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('member_id','?'))" 2>/dev/null)
  echo "  member_id: $MEMBER_ID"
  if [ "$MEMBER_ID" = "m-alice" ]; then
    echo "  PASS: member_id 正确 (m-alice)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: member_id 不正确"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  SKIP: 未获取到 imt_token cookie"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# 场景 6: state cookie 在回调后被清除(Set-Cookie: maxAge=0)
# ---------------------------------------------------------------------------
echo ""
echo "=== 场景 6: state cookie 回调后清除 ==="
# 重新发起 OAuth 获取新 state
COOKIE_JAR2=$(mktemp)
HEADER_FILE2=$(mktemp)
curl -s -o /dev/null -c "$COOKIE_JAR2" "$BFF/auth/login/github" -H "X-Tenant-Id: tenant-enterprise"
STATE2=$(grep oauth_state "$COOKIE_JAR2" | awk '{print $NF}')

if [ -n "$STATE2" ]; then
  # 回调,捕获响应 header
  curl -s -o /dev/null -D "$HEADER_FILE2" -b "$COOKIE_JAR2" \
    "$BFF/auth/oauth/callback?code=mock-code&state=$STATE2" -H "X-Tenant-Id: tenant-enterprise"
  # 检查 Set-Cookie 中是否有 oauth_state 的清除(maxAge=0 或 expires=过去)
  if grep -qi "set-cookie.*oauth_state.*max-age=0\|set-cookie.*oauth_state.*expires=" "$HEADER_FILE2"; then
    echo "  PASS: oauth_state cookie 在响应中被清除"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: oauth_state cookie 未在响应中清除"
    grep -i "set-cookie" "$HEADER_FILE2" || echo "  (无 Set-Cookie header)"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  SKIP: 未获取到 state"
  FAIL=$((FAIL + 1))
fi
rm -f "$COOKIE_JAR2" "$HEADER_FILE2"

# ---------------------------------------------------------------------------
# 清理
# ---------------------------------------------------------------------------
rm -f "$COOKIE_JAR" "$HEADER_FILE"

echo ""
echo "=========================================="
echo "结果: $PASS 通过, $FAIL 失败"
echo "=========================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
