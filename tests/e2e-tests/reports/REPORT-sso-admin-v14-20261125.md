# REPORT — sso-admin-v14（v1.4：向导 SSO 卡移除 + 管理页扩展）

日期:2026-11-25  
设计:`docs/wizard-enterprise-sso-mode-design.md` §11（设计）+ §12（评审:方向通过,R-1 吸收后定稿）  
授权:用户指令「调用九步交付实施」（设计+评审已认可,门后连续执行 6–9）

## 1. 交付摘要

| 维度 | 内容 |
|---|---|
| 产品 | 向导回归 4 卡单企业卡;统一认证(SSO)配置移交「系统管理 → 统一认证设置」(前置状态实时检测 + 渠道预览勾选 + 启用守卫 + 即时生效) |
| BFF | `services/enterprise-sso-check.ts` 新增(R-2 抽离);选项表删 SSO 卡 + `getWizardOption` R-1 回退;`sso-admin` 扩展(`stateSecretStatus` 三态/`boundBackend`/`?check=1`/`GET /admin/sso/providers`/PUT 启用守卫) |
| 兼容 | deprecated `setupProfile=enterprise-sso` setup/probe 经 R-1 回退仍 200(v0.4.9 旧 UI + 新 BFF 不炸);`hasEnterpriseBackend` 字段保留 |
| 文档 | 设计 §11/§12;两份手册改写;release-chain §5 改管理页流程;status P0 口径更新 |

## 2. 验证（步骤 7/8,Node 20.20.2 同 CI）

| 门 | 结果 |
|---|---|
| 宿主 type-check（hiedu/color-tokens/tsc） | ✅ 0 错 |
| 宿主 jest | ✅ 66 套件 / 807 用例全过（新增 sso-settings 4 例;wizard-modes 重写 4 例） |
| BFF tsc | ✅ 0 错 |
| BFF vitest | ✅ 71 文件 / 1268 用例全过（wizard 81 含 R-1 回归 W-R1 与 V 前置;sso-admin 20 含 V-01~06） |

## 3. 关键实现点

- **R-1 回退**:`getWizardOption` 在选项表缺 `enterprise-sso` 时回退企业卡——删卡不致 deprecated 路径 400（评审发现,实施吸收,用例 W-R1 固化）;
- **R-2 抽离**:SSO 四项检测抽到 `services/enterprise-sso-check.ts`,wizard probe（兼容）与管理页 `?check=1`（admin 门控）同源;
- **R-3/R-4**:管理页 PUT 启用守卫（后端缺失/未就绪 warnings）+ 默认租户 '0' 口径;
- **R-5**:`stateSecretStatus` 三态（unset/set/invalid）,兼容位 `stateSecretConfigured` 保留;
- **回归保留**:向导第 3 步重渲染循环修复（options memo + 条件写回）、probe snake_case 归一化（W-P10）。

## 4. 受限与遗留

| ID | 说明 | 后续 |
|---|---|---|
| L-V14-01 | 浏览器 e2e（管理页真实网关启用 → 登录页渠道）未执行 | 真实网关联调时补 TC-SOA-03 |
| L-V14-02 | ArgoCD/Jenkins 集群→gitee 链路退化（另案） | 平台侧修复;与本模块无关 |
| L-V14-03 | `setupProfile` 兼容分支 | 下一版删除 |
| L-V14-04 | repo 内 package.json 版本号(0.4.8)与镜像 tag 0.4.9 漂移 | v0.5.0 发版时统一 |

## 4b. 质量/安全评审（实施后）

评审记录:`docs/wizard-enterprise-sso-mode-design.md` **§13**。发现 Q-1(P1 手动渠道输入无法键入逗号分隔列表——受控输入归一化)/Q-2(P2 渠道预览受 env 白名单过滤,无法重新勾选)/Q-3(P3 未使用导入)已当场修复;Q-1 带回归断言;S 面六项复核无新增风险,CSRF 维持 backlog。修复后回归:受影响 4 套件全绿（BFF 101、FE 8）。

## 5. 发布

载体建议 **v0.5.0**（向导选型结构变化）;发版顺序红线不变:先出镜像确认入库,再单独提交改 `deploy/k8s` 的 `newTag`（ArgoCD 自动同步,勿提前）。
