# Spec — Wizard SSO/KAG/RAG 交付(批准门)

module: `wizard-sso` | 日期:2026-11-21 | 设计:`docs/wizard-kag-to-sso-design.md` v1.2

## 1. 范围

按已批准设计实施三个阶段并完成九步交付闭环:

- **P1**:向导 KAG 下架(BFF 选项表 + probe `!option→400` + bootstrap 用例换型)+ 前端 `getProtocolFamily('kag')→'mcp-protocol'`(含联合成员与测试);
- **P2**:SSO 配置区块(前端)+ `GET /admin/wizard/sso/providers`(BFF,字段裁剪)+ setup `sso` 扩展(校验/400/递归 toCamel/envSnippet/warnings)+ i18n(zh/en);
- **P3**:RAG 插件区块移除(BFF probe/setup/类型契约 + 前端表单/展示/草稿)+ Done 页 warnings 展示。

明确不动:`src/components/ui/**`、`bff/src/services/adapters/kag/**`、`harness-store.ts` zod enum、`harness-admin.ts` VALIDATION_RULES、管理端 kag 选项、`bff/src/routes/auth.ts`。

## 2. 基线执行结果(步骤 5)

| 项 | 命令 | 结果 |
|---|---|---|
| BFF 全量 | `vitest run --root=bff` | **56 文件 / 1077 用例全通过** |
| BFF tsc | `tsc --noEmit`(直调) | 通过 |
| 前端 type-check | `npm run type-check` | 通过(hiedu 快照/色彩基线均 ok) |
| 前端全量 jest | `npm run test` | 748 通过 / **2 失败**(`src/features/feature-registry.test.ts`,与向导无关的存量问题) |

## 3. 缺陷与差异清单

### 缺陷(现有代码)

| 编号 | 描述 | 处置 |
|---|---|---|
| D-01 | 前端 jest `feature-registry.test.ts` 2 例失败(基线即失败,非本模块引入) | **不修**(超批准范围);记入报告遗留建议 |
| D-02 | 向导 probe 对未知/已下架 type 继续探测(契约漏洞) | P1 修复(X-02) |
| D-03 | 前端 kag 协议族映射漂移(openai-compatible,实为 mcp) | P1 修复(X-11) |

### 差异(设计待实施项,非缺陷)

X-01~X-10 见 `outline/wizard-sso.md` §四,全部映射至 P1/P2/P3 实施项。

## 4. 修复/实施方案(含取舍)

取舍得自设计评审(§9 R1-R14):sso 非 enterprise → 400;providers 端点字段裁剪;secret 仅内存态;http publicOrigin 仅警告不阻断(setup 不复刻生产 https 强制——以 `sso-config.ts` 启动 fail-fast 为单一裁决点,向导保持非阻塞);白名单未知渠道 → warnings 非阻断。

## 5. 报告与归档路径

- 报告:`tests/e2e-tests/reports/REPORT-wizard-sso-20261121.md`
- 截图:`tests/e2e-tests/results/wizard-sso/`
- 项目记忆:报告 §6(含本机 vitest/tsc shim 怪癖、数据恢复次序)

## 6. 批准

用户已于 2026-11-21 指示「按 P1 → P2 → P3 实施」(预先授权),依据九步交付法"批准后连续执行至全部完成,不再中途确认"条款连续推进至步骤 9。
