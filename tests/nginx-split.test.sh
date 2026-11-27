#!/bin/sh
# tests/nginx-split.test.sh — docker/gen-go-split.sh 自检(spec w1b §6 nginx 行)。
# 纯 POSIX sh,无外部依赖;失败时打印断言详情并以非 0 退出。
set -u

TEST_DIR=$(dirname "$0")
GEN="$TEST_DIR/../docker/gen-go-split.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

PASS=0
FAIL=0

fail() {
  FAIL=$((FAIL + 1))
  echo "FAIL: $1"
  if [ -s "$TMP_DIR/out" ]; then
    echo "--- stdout ---"
    cat "$TMP_DIR/out"
    echo "--------------"
  fi
  if [ -s "$TMP_DIR/err" ]; then
    echo "--- stderr ---"
    cat "$TMP_DIR/err"
    echo "--------------"
  fi
}

ok() {
  PASS=$((PASS + 1))
  echo "ok: $1"
}

# run <prefixes> <upstream> [api_key]  →  结果写入 $TMP_DIR/out|err,退出码入 $RC
run() {
  RC=0
  RAG_GO_PREFIXES="$1" RAG_GO_UPSTREAM="$2" RAG_GO_API_KEY="${3:-}" \
    sh "$GEN" >"$TMP_DIR/out" 2>"$TMP_DIR/err" || RC=$?
}

expect_rc() {
  # expect_rc <expect> <name>
  if [ "$RC" -eq "$1" ]; then
    ok "$2 (exit $RC)"
  else
    fail "$2: 期望 exit $1,实际 $RC"
  fi
}

expect_stdout_contains() {
  # expect_stdout_contains <needle> <name>
  if grep -Fq -- "$1" "$TMP_DIR/out"; then
    ok "$2"
  else
    fail "$2: stdout 缺少 [$1]"
  fi
}

expect_stdout_empty() {
  if [ -s "$TMP_DIR/out" ]; then
    fail "$1: stdout 应为空"
  else
    ok "$1"
  fi
}

expect_no_literal_env() {
  if grep -Fq '${' "$TMP_DIR/out"; then
    fail "$1: stdout 残留 \${VAR} 字面量"
  else
    ok "$1"
  fi
}

expect_stdout_lacks() {
  if grep -Fq -- "$1" "$TMP_DIR/out"; then
    fail "$2: stdout 不应包含 [$1]"
  else
    ok "$2"
  fi
}

# --- 1. 空列表 → 空输出 + exit 0(默认态:行为零变化) --------------
run "" "http://127.0.0.1:9382"
expect_rc 0 "空列表"
expect_stdout_empty "空列表不输出任何 location 块"

run "   " "http://127.0.0.1:9382"
expect_rc 0 "纯空白列表"
expect_stdout_empty "纯空白列表不输出任何 location 块"

# --- 2. 单个前缀 -----------------------------------------------------
run "/api/v1/datasets" "http://127.0.0.1:9382"
expect_rc 0 "单前缀"
expect_stdout_contains "    location ^~ /api/v1/datasets {" "单前缀生成 location 块"
expect_stdout_contains "        proxy_pass http://127.0.0.1:9382\$request_uri;" "proxy_pass 使用真实上游地址"
expect_stdout_contains '        proxy_set_header X-Intellect-User "";' "清空 X-Intellect-User"
expect_stdout_contains '        include /etc/nginx/proxy-gateway.conf;' "include 网关参数"
expect_stdout_lacks 'proxy_set_header Authorization' "未配置密钥时不注入 Authorization"
expect_no_literal_env "单前缀值已展开"

# --- 3. 两个前缀(逗号分隔)+ 密钥 ------------------------------------
run "/api/v1/datasets,/api/v1/documents" "http://127.0.0.1:9382/" "go-secret"
expect_rc 0 "逗号分隔双前缀"
expect_stdout_contains "    location ^~ /api/v1/datasets {" "双前缀第 1 块"
expect_stdout_contains "    location ^~ /api/v1/documents {" "双前缀第 2 块"
expect_stdout_contains '        proxy_set_header Authorization "Bearer go-secret";' "密钥写真实值"
expect_no_literal_env "双前缀值已展开"

# 混合分隔符(空格 + 逗号)也应识别
run "/api/v1/datasets /api/v1/documents" "http://127.0.0.1:9382"
expect_rc 0 "空格分隔双前缀"
expect_stdout_contains "    location ^~ /api/v1/documents {" "空格分隔第 2 块"

# --- 4. 禁用前缀 → exit 1 -------------------------------------------
run "/api/v1/admin" "http://127.0.0.1:9382"
expect_rc 1 "禁用前缀 /api/v1/admin"
expect_stdout_empty "禁用前缀不输出任何块"

run "/api/bff" "http://127.0.0.1:9382"
expect_rc 1 "禁用前缀 /api/bff"

run "/api/v1/wargame" "http://127.0.0.1:9382"
expect_rc 1 "禁用前缀 /api/v1/wargame"

run "/api/v1/platform" "http://127.0.0.1:9382"
expect_rc 1 "禁用前缀 /api/v1/platform"

# 按段边界判定:父路径 /api/v1/ad 会捕获 /api/v1/admin,必须拒绝
run "/api/v1/ad" "http://127.0.0.1:9382"
expect_rc 1 "禁用前缀的父路径 /api/v1/ad"

run "/api" "http://127.0.0.1:9382"
expect_rc 1 "禁用前缀的父路径 /api"

run "/api/v1/admin/users" "http://127.0.0.1:9382"
expect_rc 1 "禁用前缀的子路径 /api/v1/admin/users"

# --- 5. 非法前缀 → exit 1 -------------------------------------------
run "api/v1/x" "http://127.0.0.1:9382"
expect_rc 1 "非法前缀(缺前导 /)"

run "/api/v1/../etc" "http://127.0.0.1:9382"
expect_rc 1 "非法前缀(含 ..)"

run "/api/v1/x y" "http://127.0.0.1:9382"
expect_rc 1 "非法前缀(斜杠外非法字符)"

run "/api/v1/datasets?x=1" "http://127.0.0.1:9382"
expect_rc 1 "非法前缀(含 ?)"

# --- 6. 上游缺失/非法 → exit 1 --------------------------------------
run "/api/v1/datasets" ""
expect_rc 1 "前缀非空但上游为空"

run "/api/v1/datasets" "127.0.0.1:9382"
expect_rc 1 "上游缺少 scheme"

run "/api/v1/datasets" "http://127.0.0.1:9382;rm -rf /"
expect_rc 1 "上游含非法字符"

# --- 7. 合规但形近的前缀应放行(不能误报) -----------------------------
run "/api/v1/adminx" "http://127.0.0.1:9382"
expect_rc 0 "非禁用面形近前缀 /api/v1/adminx"
expect_stdout_contains "    location ^~ /api/v1/adminx {" "形近前缀正常生成"

echo ""
echo "nginx-split: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
