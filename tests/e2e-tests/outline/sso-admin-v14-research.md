# Outline — sso-admin-v14（v1.4：向导 SSO 卡移除 + 管理页扩展）

日期:2026-11-25  
模块:`sso-admin-v14`  
设计真源:`docs/wizard-enterprise-sso-mode-design.md` §11（设计）+ §12（评审,方向通过,R-1 吸收）  
授权:用户「按这个方案执行，出 v1.4 设计草案…」→ 评审后「调用九步交付实施」→ 门后连续执行 6–9

## 触发与分析（研究结论）

v1.3 发版（v0.4.9）后对向导 SSO 卡两项核心输入的性质分析：

1. **#1 认证网关地址 / #2 网关服务密钥是部署级基础设施**：非 SSO 模式的密码登录、会话校验、Agent Loop 同样依赖——双卡前提（"是否首装准备 SSO"=两种部署形态）不成立；
2. **首装配 SSO 给不出能用的 SSO**：完成时仍需 envSnippet + 重启，配置动作与生效时序错位；
3. **安全面**：bootstrap 窗口（首装无凭据）采集 `stateSecret`（§9 S3）；管理页在管理员会话门控内；
4. **HIEDU 边界**（status §1.3）：HIEDU=身份/成员目录/对账键,不持有 imt_* / API_SERVER_KEY / 网关地址——#1/#2 不可能从 SSO 侧自动获取，配置主体只应是运维/管理员。

结论：SSO 的"配置"是**管理员能力**（运行中的系统 + 管理员会话 + 即时验证），不是**安装参数** → 移交管理页。

## 范围

- 向导:4 卡（企业单卡 = 原非 SSO 流程）;完成页/企业卡指向管理页;v1.3 双模式分支全删;
- BFF:选项表删卡 + R-1 选项查找回退（deprecated enterprise-sso setup/probe 仍 200）;SSO 检测抽共享 service（enterprise-sso-check）;
- 管理页扩展:前置状态卡（`?check=1` 实时四项检测 + stateSecret 三态）、渠道预览勾选、启用守卫、新增 `GET /admin/sso/providers`;
- 文档:两份手册、release-chain §5、status P0 口径。

## 非目标

不删 setupProfile 兼容分支（下一版）；管理页不生成/展示/落盘 stateSecret；不改登录页；不动 HIEDU 链路。
