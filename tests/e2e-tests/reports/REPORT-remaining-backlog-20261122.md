# 九步交付报告 — remaining-backlog-20261122

> 日期:2026-11-22;批准门:用户九步指令「实施」全清单;spec:[remaining-backlog-20261122-spec.md](../spec/remaining-backlog-20261122-spec.md)

## 总览

| Module | 结果 |
|---|---|
| t2-5-apps-admin | ✅ `src/ee/features/applications`;admin harness-backends/sso-settings/tenant-bindings → `src/ee/pages/*`;routes + tailwind `ee/**` content |
| t2-10-f1-notes | ✅ [chat-settings-save-f1-release-notes.md](../../../docs/chat-settings-save-f1-release-notes.md);④ 仍等 T4.2 |
| t3-2-chunk-img | ✅ reference-image-list 源文档入口 |
| t3-4-i18n | ✅ `ee/locales/{en,zh}-private.ts` + config merge |
| t3-5-font | ✅ `--font-display`/`--font-mono` + tailwind |
| t3-6-sync | ✅ `scripts/sync-upstream-web.mjs`(archive+rsync) |
| oxlint-tighten | ✅ 裁决=不替换 eslint;[oxlint-policy.md](../../../docs/oxlint-policy.md);安全 warning 收紧 |
| csl-toast | ✅ `skipErrorNotification` + fetchSessionManually |

## 受限(未伪造)

| ID | 内容 |
|---|---|
| L-T42-01 | T4.2 M1+ / 写侧 prune / secrets API |
| L-T41B | 检索 provider 分发 Phase C |
| L-T33 | builtin-pipeline / 上游 Go API |
| L-T5 | Go 化 A–D |
| L-09/L-10 | 生产首装 + D1 + flag / BFF 环境 |
| L-CSL-01/03/04 | 上游 500、脏列表、不存在应 404 |

## 评审加固(质量+安全)

| 项 | 处置 |
|---|---|
| sync `--delete` + 窄 exclude | 默认关闭 delete;需 `--prune-deletes`;扩大 exclude(鉴权/请求/i18n config) |
| `skipErrorNotification` 挡 401 | 401 始终登出/复验;skip 仅抑制 `errorHandler` toast |
| zh 缺 `tenantBinding` | 已补 `ee/locales/zh-private.ts` |
| en overlay 浅合并 | `lodash.merge` 深度合并 |

## 九步闭环

调研/spec ✅;实施 ✅;评审加固 ✅;门禁见本批提交前 type-check/oxlint;受限编号登记 ✅。
