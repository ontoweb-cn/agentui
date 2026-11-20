#!/usr/bin/env bash
# 发版后冒烟（部署侧只读检查）
# 用法: bash scripts/smoke-deploy.sh https://agentui.wust.edu.cn
set -euo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "用法: $0 <base-url>，例如 $0 https://agentui.wust.edu.cn" >&2
  exit 2
fi
BASE="${BASE%/}"

fail() { echo "✗ $1" >&2; exit 1; }
ok() { echo "✓ $1"; }

code=$(curl -sS -o /tmp/smoke-health.json -w '%{http_code}' --max-time 15 "$BASE/api/bff/health" || true)
[ "$code" = "200" ] || fail "health 期望 200，实际 $code"
grep -q '"status":"ok"' /tmp/smoke-health.json || fail "health 响应非 ok: $(cat /tmp/smoke-health.json)"
ok "health 200"

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/" || true)
[ "$code" = "200" ] || fail "首页期望 200，实际 $code"
ok "前端首页 200"

code=$(curl -sS -o /tmp/smoke-config.json -w '%{http_code}' --max-time 15 \
  -H 'X-Backend-Id: 0' "$BASE/api/bff/auth/config" || true)
[ "$code" = "200" ] || fail "auth/config 期望 200，实际 $code"
node -e 'const j=require("/tmp/smoke-config.json");process.exit(j&&j.code===0?0:1)' \
  || fail "auth/config 返回非 code=0: $(cat /tmp/smoke-config.json)"
ok "auth/config code=0"

code=$(curl -sS -o /tmp/smoke-channels.json -w '%{http_code}' --max-time 20 \
  -H 'X-Backend-Id: 0' "$BASE/api/bff/auth/login/channels" || true)
[ "$code" = "200" ] || fail "channels 期望 200，实际 $code"
node -e 'const j=require("/tmp/smoke-channels.json");process.exit(j&&j.code===0&&Array.isArray(j.data)?0:1)' \
  || fail "channels 返回结构异常: $(cat /tmp/smoke-channels.json)"
channels=$(node -e 'const j=require("/tmp/smoke-channels.json");console.log(j.data.length)')
ok "channels code=0（$channels 个渠道）"

# 授权入口：关闭态回登录页，开启态跳 IdP，均应为 302
loc=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 \
  "$BASE/api/bff/auth/sso/authorize/intellect-auth?tenant=0" || true)
code="${loc%% *}"
[ "$code" = "302" ] || fail "authorize 期望 302，实际 $loc"
ok "authorize 302 → ${loc#* }"

rm -f /tmp/smoke-health.json /tmp/smoke-config.json /tmp/smoke-channels.json
echo "冒烟通过: $BASE"
