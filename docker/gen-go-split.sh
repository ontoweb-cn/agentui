#!/bin/sh
# D10 路径级灰度分流生成器(spec 2026-11-27-go-migration-w1b §5.2)。
#
# 读 RAG_GO_PREFIXES / RAG_GO_UPSTREAM / RAG_GO_API_KEY,向 stdout 打印
# nginx `location ^~ <prefix> { ... }` 块。RAG_GO_PREFIXES 为空/空白时
# 打印空内容并退出 0 —— 重定向即得到空文件,nginx 行为零变化。
#
# 生成的是「已展开」的静态配置(nginx 不对该文件做 envsubst),
# 因此 proxy_pass / Authorization 写真实值,不能写 ${VAR} 字面量。
#
# 用法:
#   RAG_GO_PREFIXES='/api/v1/datasets' RAG_GO_UPSTREAM='http://127.0.0.1:9382' \
#     gen-go-split.sh > /etc/nginx/http.d/go-split.conf
set -eu

# 禁用前缀:管理面 / 平台通道 / BFF 自身 / 画布。与 BFF 侧
# bff/src/utils/rag-base-url.ts 同源规则,误切到 Go 会造成权限语义错乱。
FORBIDDEN_PREFIXES='/api/v1/admin /api/v1/platform /api/bff /api/v1/wargame'
MAX_PREFIX_LEN=128

err() {
  echo "gen-go-split: $*" >&2
}

prefixes="${RAG_GO_PREFIXES:-}"
upstream="${RAG_GO_UPSTREAM:-}"
api_key="${RAG_GO_API_KEY:-}"

# 列表语法:空格和/或逗号分隔(逗号/制表符/换行统一成空格后由 for 切词)
list=$(printf '%s' "$prefixes" | tr ',\t\n' '   ')

# 空列表 → 不输出任何内容(默认路径:行为完全不变)
if [ -z "$(printf '%s' "$list" | tr -d ' ')" ]; then
  exit 0
fi

if [ -z "$upstream" ]; then
  err "RAG_GO_PREFIXES 非空但 RAG_GO_UPSTREAM 为空,无法生成分流块"
  exit 1
fi
case "$upstream" in
  http://* | https://*) ;;
  *)
    err "RAG_GO_UPSTREAM 必须以 http:// 或 https:// 开头: $upstream"
    exit 1
    ;;
esac
case "$upstream" in
  *[!A-Za-z0-9.:/_-]*)
    err "RAG_GO_UPSTREAM 含非法字符: $upstream"
    exit 1
    ;;
esac

# 密钥直接落进配置文件,拒绝会破坏 nginx 引号/换行的字符
if [ -n "$api_key" ]; then
  case "$api_key" in
    *'"'* | *\\* | *'$'* | *';'* | *[[:space:]]*)
      err "RAG_GO_API_KEY 含非法字符(引号/反斜杠/\$/分号/空白)"
      exit 1
      ;;
  esac
fi

for prefix in $list; do
  # 归一化:去掉尾部斜杠(保留根 /),与 BFF 侧匹配规则保持一致
  while [ "$prefix" != "/" ] && [ "${prefix%/}" != "$prefix" ]; do
    prefix="${prefix%/}"
  done

  case "$prefix" in
    /*) ;;
    *)
      err "非法前缀(必须以 / 开头): $prefix"
      exit 1
      ;;
  esac
  case "$prefix" in
    *[!A-Za-z0-9/._-]*)
      err "非法前缀(仅允许 A-Za-z0-9 / _ . -): $prefix"
      exit 1
      ;;
  esac
  case "$prefix" in
    *..*)
      err "非法前缀(不允许路径穿越 ..): $prefix"
      exit 1
      ;;
  esac
  if [ "${#prefix}" -gt "$MAX_PREFIX_LEN" ]; then
    err "非法前缀(长度 ${#prefix} > $MAX_PREFIX_LEN): $prefix"
    exit 1
  fi

  for forbidden in $FORBIDDEN_PREFIXES; do
    # 双向包含判定,按 nginx `^~` 的真实语义:
    # - 禁用面被前缀按字符串覆盖(`/api/v1/ad` 会捕获 `/api/v1/admin`)→ 拒绝,
    #   因为 nginx 前缀匹配不看路径段边界;
    # - 前缀落在禁用面内部(`/api/v1/admin/x`)→ 拒绝(按段边界,避免
    #   `/api/v1/adminx` 这类同段形近前缀被误杀)。
    case "$forbidden" in
      "$prefix"*)
        err "禁用前缀(会捕获 $forbidden): $prefix"
        exit 1
        ;;
    esac
    case "$prefix" in
      "$forbidden"/*)
        err "禁用前缀(位于 $forbidden 之下): $prefix"
        exit 1
        ;;
    esac
  done

  echo "    location ^~ ${prefix} {"
  echo "        proxy_pass ${upstream}\$request_uri;"
  # 清空客户端可伪造的身份头:Go 入口只认网关注入的身份 + 网关密钥
  echo '        proxy_set_header X-Intellect-User "";'
  echo '        proxy_set_header X-Intellect-Tenant "";'
  echo '        proxy_set_header X-Intellect-Team "";'
  echo '        proxy_set_header X-Intellect-Project "";'
  echo '        proxy_set_header X-Intellect-Role "";'
  if [ -n "$api_key" ]; then
    echo "        proxy_set_header Authorization \"Bearer ${api_key}\";"
  fi
  echo '        include /etc/nginx/proxy-gateway.conf;'
  echo "    }"
done
