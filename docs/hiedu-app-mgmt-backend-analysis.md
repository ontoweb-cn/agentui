# HIEDU 应用管理"纳管"后端 Go 逻辑分析(v0.2.17)

> 分析基线:`intellect-auth` 仓库 tag **v0.2.17**(commit cc541b3;gitee/main HEAD b836658 为 v0.2.17 的 release 提交,二者 hiedu/ 目录内容一致,已比对)。工作树检出在 main@v0.2.4,故本文所有引用均取自 `git archive v0.2.17` 的快照,行号以该 tag 为准。
> 代码位于仓内 `hiedu/` 子目录(Casdoor fork 中的独立 Go 服务)。本文所有行号引用格式:`hiedu/<pkg>/<file>.go:<行号>`。
> 阅读范围:api/server.go、api/server_app.go、app/appmgmt.go、app/appcatalog.go、app/apppush.go、app/outbox_app.go、app/outbox.go、app/access.go、app/reconcile_app.go、app/reconcile_app_dims.go、domain/app.go、domain/org.go、idp/idp.go,及配套 server_app_test.go / appmgmt_test.go / appcatalog_test.go / outbox_app_test.go / outbox_internal_test.go / channel3_test.go / reconcile_app_test.go。

---

## §1 端点与鉴权全景

### 1.1 鉴权中间件

- 两种鉴权模式(`hiedu/api/server.go:29-42`):
  - `gateway`:网关注入 JWS 断言头 `X-Hiedu-Assertion`,由 `Verifier` 验签后 `LoadPrincipal` 解析本地主体(`hiedu/api/server.go:298-317`);
  - `static`:非生产用,`X-API-Key`→静态管理员(含 `PermAll` + Scope.All,`hiedu/api/server.go:321-328`)、`X-App-Key`→组织级只读应用主体(`server.go:329-337`)。Key 比较用定长常数时间比较防时序侧信道(`server.go:368-374`)。
- 中间件三件套(`hiedu/api/server.go:235-289`):`require(perm)`、`requireAny([...])`、`requireAuthenticated`(仅认证不查权限点)。断言缺失/伪造/过期 → 401;人员未匹配/无权限 → 403;拒绝与失败写操作均落审计(`auth.reject` / `api.reject`,`server.go:264-268`、`341-350`)。
- 权限点常量:`role:admin`、`project:write`、`unit:write` 等(`hiedu/domain/access.go:13,20,35`)。

### 1.2 应用纳管路由表(`hiedu/api/server.go:206-231` 注册;handler 实现 `hiedu/api/server_app.go`)

| 方法 | 路径 | 路由层权限 | 服务层二次门 | handler/服务引用 |
|---|---|---|---|---|
| GET | `/api/apps` | `role:admin` | appAdminGate(role:admin+校级) | `server_app.go:32-40` → `appmgmt.go:197-200` |
| POST | `/api/apps` | `role:admin` | appAdminGate | `server_app.go:84-99` → `appmgmt.go:239-242` |
| GET | `/api/apps/{code}` | `role:admin` | appAdminGate;非法编码 400、不存在/跨组织 404 | `server_app.go:70-82` → `appmgmt.go:320-334` |
| POST | `/api/apps/{code}/deregister` | `role:admin` | appAdminGate;非 active → ErrInvalidTransition | `server_app.go:101-112` → `appmgmt.go:338-353` |
| POST | `/api/apps/{code}/purge` | `role:admin` | appAdminGate;仅要求应用存在(不限状态) | `server_app.go:114-125` → `appmgmt.go:401-412` |
| GET | `/api/apps/{code}/permissions` | 任一 role:admin / project:write / unit:write | **无服务层门**(服务方法直接按 org 查询) | `server_app.go:127-140` → `appmgmt.go:527-538` |
| POST | `/api/apps/{code}/permissions` | `role:admin` | appAdminGate;应用须 active | `server_app.go:142-160` → `appmgmt.go:464-491` |
| GET | `/api/idp-applications` | `role:admin` | appAdminGate(触发对 IdP 出网,部门级 admin 拒绝) | `server_app.go:44-52` → `appcatalog.go:34-38` |
| GET | `/api/apps/{code}/bindings` | `role:admin` | appAdminGate | `server_app.go:55-67` → `appcatalog.go:111-117` |
| GET/POST | `/api/apps/{code}/project-links` | `project:write` | 服务层再查 `project:write` + 项目范围 | `server_app.go:162-195` → `appmgmt.go:594-601,917-923` |
| GET/POST | `/api/apps/{code}/unit-links` | `unit:write` | 服务层再查 `unit:write` + 团队范围 | `server_app.go:197-230` → `appmgmt.go:652-658,945-951` |
| POST | `/api/apps/{code}/grants` | requireAuthenticated | 服务层按 `scope_kind` 分档:project→`project:write`+范围、team→`unit:write`+范围 | `server_app.go:232-250` → `appmgmt.go:724-833` |
| DELETE | `/api/apps/{code}/grants/{id}` | requireAuthenticated | 服务层按直授行 `scope_kind` 同范围校验 | `server_app.go:252-264` → `appmgmt.go:870-899` |
| GET | `/api/apps/{code}/grants?project_id=/unit_id=` | 任一 project:write / unit:write | 服务层要求**恰好一个**维度并做范围校验 | `server_app.go:268-302` → `appmgmt.go:974-1015` |
| POST | `/api/apps/{code}/reconcile` | `role:admin` | **无服务层门**(仅取 `p.OrgCode`) | `server_app.go:306-328` → `reconcile_app_dims.go:539-547` |

补充口径:

- `appAdminGate` 定义于 `hiedu/app/appmgmt.go:50-58`:`actor.Has(role:admin) && actor.Scope.All`,即"组织管理员且校级范围"。部门级 role:admin 会被服务层 403(评审 A1 回归:`server_app_test.go:606-622`、`appcatalog_test.go:227-248`)。
- `POST /api/apps` 的组织来源强制取认证主体,请求体 `org_code` 仅作展示不采信,防跨组织注册(`hiedu/api/server_app.go:91-92`)。
- grants 相关三端点路由层"仅认证"的原因:权限点由 `scope_kind` 静态不可判,统一放行后在服务层做档位判定(注释 `server.go:206-209`;测试 `server_app_test.go:203-208`:普通成员打 grants → 服务层 403)。
- `GET /api/apps/{code}/permissions` 与 `POST /api/apps/{code}/reconcile` 两个端点服务层无范围二次门:前者为只读目录(`appmgmt.go:526-538`),后者会触发对 IdP/应用侧的出网拉取(`reconcile_app_dims.go:539+` 调维度①②),部门级 role:admin 可触发——见 §8 风险 R4。

---

## §2 注册生命周期(RegisterApp)

实现:`hiedu/app/appmgmt.go:239-316`;入参 `AppInput`:`appmgmt.go:196-207`。

**校验规则(按顺序)**:

1. 权限门 `appAdminGate`(role:admin + 校级,`appmgmt.go:240-242`)。
2. `app_code` 格式:`^[a-z0-9][a-z0-9-]{1,30}$`(小写字母数字连字符,2~31 位,`appmgmt.go:22,27-32`;测试矩阵含大小写/下划线/过短/超长/空:`appmgmt_test.go:87-91`)。
3. `display_name` 必填(`appmgmt.go:246-248`)。
4. `sync_mode` 语义(`appmgmt.go:249-257`):
   - **空 → 默认 `api_push`**;可选 `api_push` / `idp_role` / `manual`(常量 `hiedu/domain/app.go:10-14`),其它值 400。
   - `api_push`(API 直连,通道③):映射/直授变更经 outbox 以 M2M Bearer 直推应用侧 REST(`apppush.go:82-97`);**注册时不校验** `api_base_url`/`m2m_client_id` 是否已填——缺失延迟到任务执行期暴露(见 §7-3)。
   - `idp_role`(IdP 角色,通道②):平台档经 IdP Role 壳(`app/<code>-<perm>` 命名,`outbox_app.go:50`)分发,壳由部署预建(`outbox_app.go:560-613`,壳缺失跳过不代建,U10)。
   - `manual`(仅登记):只落库、所有推送任务执行期按 `sync_mode` 跳过并置 done(`outbox_app.go:91-93,308-311`;测试 `outbox_app_test.go:331-383`)。
5. `permissions[]` 目录行入参预校验,失败不进事务(`appmgmt.go:259-263`):`perm_code` 与应用编码同格式(`appmgmt.go:42-47`)、`display_name` 必填、`kind ∈ platform/project/team`(空默认 platform,`appmgmt.go:217-225`);**kind=platform 强制 assignable=false**(平台档唯一事实源 = hiedu RBAC,§3.3 v0.5,`appmgmt.go:230-233`;测试 `appmgmt_test.go:130-142`)。
6. `idp_ref`(IdP 侧应用名):TrimSpace 后 ≤150 字符,超长拒绝(`appmgmt.go:266-269`;测试 `appcatalog_test.go:274-282`)。
7. 事务内:`GetApp` 命中且 status=active → `ErrDuplicateActive`;**已注销(deregistered)的同码应用允许重新注册**(P7 防复活语义:彻底清洗须先 Purge,`appmgmt.go:237-238,271-278`;测试 `appmgmt_test.go:127-129`)。
8. 落库:注册行 Upsert + 目录行逐条 Upsert(`Source="manual"`、status=active,`appmgmt.go:279-303`)+ 审计 `app.register`(含 sync_mode 与目录行数,`appmgmt.go:304-307`)+ 应用角色目录 TTL 缓存失效(`appmgmt.go:314`,缓存实现 `appmgmt.go:76-130`,30s org 级 TTL)。

**IdP 目录预填 idp_ref**:这是**前端行为**——注册弹窗从"未纳管应用"面板打开时以 `idp_ref: app.name` 预填(`src/pages/user-setting/intellect-auth/apps.tsx:461`);后端仅把 `idp_ref` 作为普通字段存储与长度校验,注册时不与 IdP 校验一致性。`idp_ref` 的唯一后端用途是 managed 判定(§5)。

**重新注册恢复语义**:`RegisterApp` 只重建注册行与注册时提交的目录;旧注销遗留的目录行(revoked)、直授(inactive)、映射(deregistered)**不会自动复活**——重新直授须目录行 active(`appmgmt.go:757-764`),映射须重新 Upsert(status 传空即 active,`appmgmt.go:558-566,637-641`)。

---

## §3 注销 DeregisterApp(软失效,可恢复)

实现:`hiedu/app/appmgmt.go:336-395`。前端契约文案:"注销后:目录行软失效(停发角色引用)、该应用全部直授撤销、映射行下线,并投递反向清理任务(Role 壳摘除 + 应用侧成员清除)。可用「重新注册」恢复"(`apps.tsx:606-607`)。

事务内动作(单事务,`appmgmt.go:346-389`):

1. **状态机**:`GetApp` 必须存在且 status=active,否则 `ErrInvalidTransition`(重复注销 400,`appmgmt.go:347-353`;HTTP 口径测试 `server_app_test.go:302-305`);置 `deregistered`(`appmgmt.go:354-357`)。
2. **目录停发**:全部目录行置 `revoked`(已 revoked 幂等跳过,`appmgmt.go:358-372`)。停发的生效机制是两级白名单:`LoadPrincipal` 对角色权限点里的 `app/<code>:<perm>` 查目录(30s TTL 缓存),非 active 目录行不再计入权限并记 Warnings("注销软失效对调用方可见,R8",`hiedu/app/access.go:122-131`;测试 `appmgmt_test.go:220-239`)。
3. **反向清理投递(先于直授吊销执行)**:`enqueueAppRoleClearance`(`appmgmt.go:373-377` → `outbox_app.go:965-1006`),依赖 active 直授行定位受影响人员:
   - **应用侧成员清除(通道③)**:按应用全部 active **项目** link × 其上 active 项目档直授,逐人投 `app.member.remove`(`outbox_app.go:974-992`);handler 执行时按 link 名删应用侧 `_sync` 行,任意状态的 link 行均可定位(`unitLinkAnyStatus`/GetProjectLink 不查状态——防"注销级联先置 link 非活跃导致删不到",`outbox_app.go:439-459,799-812`;回归测试 `outbox_app_test.go:537-584`)。
   - **Role 壳摘除(通道②)**:仅 `sync_mode=idp_role` 的应用,取全部 active **平台档**目录行逐个投 `user.app_roles`(`outbox_app.go:993-1004`);handler 执行时期望集为空(目录行 revoked)→ 全量重算后清空 IdP Role 壳 Users(`outbox_app.go:580-584,614-626`;`UpdateRoleUsers` 传空数组=显式清壳,`hiedu/idp/idp.go:312-322`)。api_push/manual 应用即使配置了平台档目录行也不经通道②维护,壳不会被清理(`outbox_app.go:993` 注释)。
4. **直授撤销**:`RevokeAppGrantsByApp` 把该应用全部 active 直授置 inactive(`appmgmt.go:378`;含项目/团队两档,测试 `appmgmt_test.go:213-215`)。inactive 后**不自动恢复**,须重新直授(`hiedu/domain/app.go:29-33` 注释)。
5. **映射下线**:`SetAppLinksStatus` 把项目/团队映射全部置 `deregistered`(评审 M1:防同码重注册时旧 active link 立即复活补推,`appmgmt.go:382-386`)。链接行保留(标记语义,purge 才物理删除)。
6. 审计 `app.deregister`(含 perms/grants_revoked/links_offline 计数,`appmgmt.go:387-388`)+ 目录缓存失效(`appmgmt.go:393`)。

**可恢复性**:同码应用可重新注册(§2 第 7 条);注销后 grants 列表为空可经 API 观测(`server_app_test.go:277-315`)。

**已知缺口(§8 R1)**:`enqueueAppRoleClearance` 只枚举**项目** link 与**项目档**直授(`outbox_app.go:974-992`);**团队档直授(scope_kind=team)经团队 link 落位的 `_tsync` 成员行在注销时没有对应 remove 任务投递**——数据库直授被吊销,但应用侧团队维度成员行会残留,只能靠对账维度①的 `hiedu_extra` 漂移报告浮出(`reconcile_app_dims.go:31-35,345-349`),不会自动收敛。

---

## §4 清除 PurgeApp(物理删除)

实现:`hiedu/app/appmgmt.go:397-459`。前端契约文案:"物理删除注册行、权限目录、映射与直授历史,并清洗角色中悬空的 `app/<code>:*` 权限引用。仅用于防止同编码重注册复活,一般无需执行"(`apps.tsx:651-653`)。

事务内动作(单事务,`appmgmt.go:409-452`):

1. **前置**:`GetApp` 必须存在(**不限状态**——active 也可直接 purge,无"须先注销"校验,`appmgmt.go:409-412`)。
2. **悬空引用清洗**:前缀 `app/<app_code>:` 逐角色过滤 `role.permissions` 数组,有变化则 UpsertRole 并计数(`appmgmt.go:413-434`)。`role_assignment` 表只按 role_code 引用角色、无权限点列,无可清洗引用;清洗后空权限角色的分配保留(角色不删,防误删正常分配,`appmgmt.go:397-400` 注释)。
3. **逐表物理删除**(先删引用方,最后删注册行,`appmgmt.go:435-450`):`app_grant`(含 active+inactive 全部历史)→ 项目/团队 link → `app_permission` 目录 → `app_registry` 注册行。purge 后 `GetApp` 404、目录为空、角色无 `app/<code>:*` 残留、同码可干净重注册(`appmgmt_test.go:251-282`)。
4. 审计 `app.purge`(roles_cleaned/grants/links/perms 计数,`appmgmt.go:451-452`)+ 缓存失效(`appmgmt.go:457`)。

**确认机制**:后端 `POST /api/apps/{code}/purge` **无请求体、无服务端确认令牌**(`hiedu/api/server_app.go:114-125`);"输入应用编码确认"是纯前端闸门(`apps.tsx:198-199` `purgeConfirm !== target.app_code` 阻止提交、`apps.tsx:639` 禁用按钮、`apps.tsx:655-661` 输入框)。后端防线只有:role:admin+校级门 + 审计留痕。

**已知缺口(§8 R2)**:purge **不投递任何 outbox 反向清理任务**(对照注销,`appmgmt.go:409-452` 中无 enqueue 调用)。若对 active 应用直接 purge(或注销后 outbox 尚未执行完就 purge),IdP Role 壳成员、应用侧成员行不会被清理;且 purge 删除 link 行后,迟到的 remove 任务会因"link missing"被跳过置 done(`outbox_app.go:444-447,452-456`),应用侧行彻底失去收敛路径。仅 `user.app_roles` handler 对"目录行已被 purge"有空集清壳逻辑(`outbox_app.go:580-584`),但它只作用于已被投递的任务,不会自发自投。

---

## §5 managed 判定与 IdP 目录同步逻辑

实现:`hiedu/app/appcatalog.go:30-74`;IdP 客户端 `hiedu/idp/idp.go:326-334`(GET `/api/get-applications?organization=<org>`,Basic 凭据,响应解码白名单 `Application` 结构,clientSecret 等凭据字段不落结构体,RB3,`idp.go:56-66,176-199`)。

- `ListIdpApplications` 流程(`appcatalog.go:34-74`):
  1. `appAdminGate`(role:admin + 校级;部门级 admin 不得触发对 IdP 的同步出网,`appcatalog.go:31-33`);
  2. 拉取 IdP 组织应用目录(IdP 失败原样上抛,前端对"未纳管"面板单独降级,`appcatalog.go:38-41`);
  3. **managed 判定**:`app_registry` 全量行中,`IdpRef != "" && Status == active` 的行,按 `IdpRef` 精确匹配 IdP 应用的 `Name` 建 managed 集合(`appcatalog.go:42-56`)。**仅 active 行计入**——注销应用的 idp_ref 保留作历史但不再算"已纳管",未纳管面板重新允许注册(评审 A3,`appcatalog.go:48-53`;测试 `appcatalog_test.go:251-271`)。purge 后注册行消失,同样不算 managed。
  4. 输出白名单视图(`Id/Owner/Name/DisplayName/HomepageURL/Logo/Tags/Managed`),无凭据(`appcatalog.go:19-28,60-72`);跨组织应用不泄露(IdP 按 org 过滤,测试 `appcatalog_test.go:79-81`)。
- **过滤发生在前端**:后端返回**全部**目录行并附 managed 标记;前端 `unmanaged = (idpApps ?? []).filter(app => !app.managed)` 只把 managed=false 的行渲染进"未纳管应用"面板(`src/pages/user-setting/intellect-auth/apps.tsx:171-172,425-461`)。
- 目录同步是**只读代理**:不向 IdP 写应用;目录行导入 hiedu 走注册/`UpsertAppPermission` 的 `Source="manual"`(`appmgmt.go:298,496`)。`AppPermission.Source` 预留了 `idp_sync` 值(`hiedu/domain/app.go:61`),但 v0.2.17 中未见写入 `idp_sync` 的代码路径(未核实到实现,标注为**未核实/预留**)。

---

## §6 access/权限模型(与 AgentUI 三档 platform/project/team 的对应)

**目录三档**(`hiedu/domain/app.go:16-21`,决定 UI 位置与分发通道):

| 档位 | 事实源 | 可直授 assignable | 分发通道 | 对应 AgentUI 侧 |
|---|---|---|---|---|
| platform | hiedu RBAC(role_assignment × role.permissions 含 `app/<code>:<perm>`) | 强制 false(`appmgmt.go:230-233`) | 通道② `user.app_roles`:重算 IdP Role 壳 `Users` 全量(仅 idp_role 模式,`outbox_app.go:560-627`) | 平台档(跟随 hiedu 角色,不由应用管理页直授) |
| project | `app_grant`(scope_kind=project)+ `app_role_map`(entity=project)默认 seed 兜底 | 默认 true | 通道③ api_push `_sync`(`apppush.go:319-342`) | 项目档(project:write 授予者 + 项目范围) |
| team | `app_grant`(scope_kind=team)+ `app_role_map`(entity=team)seed | 默认 true | 通道③ api_push `_tsync`(`apppush.go:346-368`) | 团队档(unit:write 授予者 + 团队范围) |

- **直授 scope_kind=platform 被拒绝**(平台档唯一源为 RBAC,§3.3 v0.5,`appmgmt.go:728-731`;测试 `appmgmt_test.go:322-325`、HTTP 400 `server_app_test.go:237-242`)。
- **直授五项校验**(`appmgmt.go:724-867`,注释行 721-723):① scope_kind ∈ project/team;② 目录行存在且 active 且 kind 与档位匹配(757-767);③ assignable(768-771);④ 项目档须 active 项目成员(项目还须 active 状态,校验⓪,780-806)/ 团队档须 active 团队成员(807-832);⑤ owner_only 仅项目负责人本人(834-842)。同元组重复 active → `ErrDuplicateActive`(active-only 唯一,撤销-重授走新行,`appmgmt_test.go:412-441`)。
- **RBAC 侧护栏**:
  - 角色可包含 `app/<code>:<perm>` 权限点,但须通过两级白名单(编译期核心权限点 + 应用角色目录 active 行,`appmgmt.go:145-177`;`UpsertRole` 校验 `access.go:1384-1391`,未登记/畸形形态/`*` 均拒绝,测试 `appmgmt_test.go:757-790`)。
  - 应用权限点**豁免 CanGrant 防提权检查**(其执行方在应用侧,role:admin+Scope.All 已把关,P5,`access.go:1199-1211,1392-1395,1470-1472`)。
  - 平台档 Role 壳重算挂钩覆盖 RBAC 全部变更路径:角色增改(`access.go:1422-1434`,新旧权限点并集重算)、停用/启用(`access.go:1358-1359`)、分配(`access.go:1504-1505`)、撤销分配(`access.go:1541-1549`);`enqueueAppRolePointsForPerms` 仅对 active 且 idp_role 的应用投递(`outbox_app.go:712-734`)。
  - **执行时重算语义(H7)**:所有 app.* / user.app_roles handler 不信任入队时的增量,执行期从 DB 重算期望全量再 diff(`outbox_app.go:17-24` 注释;`desiredAppMemberRole`/`desiredAppUnitMemberRole` 直授优先→seed 兜底→均无不落行,`outbox_app.go:190-283`;测试 `outbox_app_test.go:175-279`)。
- **主体/范围模型**:`LoadPrincipal` 把断言主体映射到本地人员(外部身份 `intellect:{member_id}` 或 idp_unified_id,`access.go:17-66`),人员非 active 403;权限点来自未停用角色的权限集合(应用权限点经动态白名单过滤,`access.go:117-131`);数据范围 `Scope{All, Paths, ExactPaths}` 由角色分配的 unit 子树物化路径构成,停用节点不参与匹配(`access.go:133-168`),超上限 `ErrScopeTooLarge`(`access.go:161-163`)。

---

## §7 与 AgentUI 前端契约的核对结论

前端语义来源:`src/pages/user-setting/intellect-auth/apps.tsx`、`src/services/hiedu/shared/resources.ts`(AgentUI 仓库现有代码,本次已复核原文)。逐条结论:

| # | 前端契约 | 结论 | 后端依据 |
|---|---|---|---|
| 1 | 注销 = 软失效、可恢复(`apps.tsx:606-607`;`resources.ts:773-777` POST `…/deregister`) | **后端证实** | 状态置 deregistered、目录 revoked、直授 inactive、映射下线均为软操作,同码可重注册(`appmgmt.go:354-386,237-238`;测试 `appmgmt_test.go:202-249`)。注意"恢复"的含义:重注册不会自动恢复旧目录/直授/映射(见 §2),前端文案"可用重新注册恢复"成立但需重新配置。 |
| 2 | 注销文案"投递反向清理任务(Role 壳摘除 + 应用侧成员清除)" | **后端证实,但有范围出入(见差异①)** | 投递 `app.member.remove` + `user.app_roles`(`appmgmt.go:373-377` → `outbox_app.go:965-1006`)。 |
| 3 | 清除 = purge 物理删除、需输入应用编码确认(`apps.tsx:198-199,620-661`;`resources.ts:779-783`) | **后端证实,确认机制仅前端(见差异②)** | 物理删除范围与前端文案逐项吻合(注册行/权限目录/映射/直授历史/`app/<code>:*` 清洗,`appmgmt.go:397-459`)。 |
| 4 | api_push 才需 api_base_url + m2m_client_id(`apps.tsx:544-551,554-561` 占位文案"仅 API 直连模式需要";secret 走环境变量) | **后端证实(运行时软约束,见差异③)** | secret 只存环境变量不落库(`appmgmt.go:202` 注释、`apppush.go:31-35,130-135`,env 前缀 `HIEDU_APP_PUSH_SECRET_<APP_CODE 大写/_ 替换>`);`endpointOf` 缺 api_base_url/m2m_client_id → `errTurnManual` 任务立即转 manual(`apppush.go:43-50`、`outbox.go:197-204`;测试 `outbox_app_test.go:283-327`)。 |
| 5 | managed=false 过滤目录(`apps.tsx:171-172,425-461`) | **后端证实** | 后端返回全量目录 + managed 标记,managed 仅 active 且 idp_ref 命中(`appcatalog.go:42-56`);过滤在前端完成。注销后不再计 managed(A3)与前端"重新允许注册"语义一致。 |
| 6 | purge 文案"清洗角色中悬空的 `app/<code>:*` 权限引用" | **后端证实** | `appmgmt.go:413-434`;前端 purge 弹窗的 code 示例与后端前缀拼接一致。 |
| 7 | IdP 目录不可达仅降级本面板(`apps.tsx` 头注释 5 行) | **后端证实** | `ListIdpApplications` IdP 错误原样上抛,不与已纳管列表耦合(`appcatalog.go:37-41`;注释同义)。 |

**差异/需注意点**:

- **差异①(注销反向清理覆盖面)**:前端"应用侧成员清除"未区分维度;后端只对**项目维度**投 remove 任务,团队维度 `_tsync` 行不投(`outbox_app.go:974-992` 仅枚举项目 link,对比 §3 缺口)。且"Role 壳摘除"仅 idp_role 模式生效(`outbox_app.go:993-1004`)——api_push 应用注销时平台档壳不动(设计如此:壳不经通道②维护)。
- **差异②(purge 确认与前置)**:输入应用编码确认纯前端;后端无确认载荷、也不强制"先注销再清除"(active 可直接 purge,`appmgmt.go:409-412`)。前端提示"仅用于防止同编码重注册复活"是使用建议而非后端约束。另 purge 不触发反向清理(§4 缺口)。
- **差异③(api_push 配置校验时机)**:后端注册时不校验 api_push 应用是否已填 api_base_url/m2m_client_id、也不校验 URL 形态;缺失/坏配置在任务执行期才转 manual 并写 `link.last_error`(`outbox_app.go:126-129,144-182`)。"需要"是运行期约束。
- **差异④(默认 sync_mode)**:前端表单默认 `sync_mode: 'manual'`(`apps.tsx:86`)且总是显式提交;后端对空值默认 `api_push`(`appmgmt.go:249-252`)。`resources.ts:278` 注释"空默认 api_push"与后端一致——当前 UI 行为不受影响,但两处默认值语义不同,第三方调用方传空会得到 api_push 而非 manual。
- **差异⑤(API 形状)**:前端 `AppRegisterInput`(resources.ts:273-281)与后端 `AppInput`(appmgmt.go:196-207)字段一一对应(json tag 一致);`AppSummary`(resources.ts:231)对应后端 `appcatalog.go:188-193`(catalog_count/link_count/grant_count 仅统计 active 行,`appcatalog.go:195-227`;注销后计数归零、注册行仍列出,`appcatalog_test.go:210-223`)。无字段错位。

---

## §8 风险与遗留

- **R1 注销反向清理遗漏团队维度**(功能性缺口):`enqueueAppRoleClearance` 只枚举项目 link × 项目档直授(`hiedu/app/outbox_app.go:974-992`);团队档直授的数据库行被 `RevokeAppGrantsByApp` 吊销(`appmgmt.go:378`),但应用侧团队 `_tsync` 成员行无 remove 任务,注销后残留。`removeAppMember` 的团队分支与 `unitLinkAnyStatus` 已具备执行能力(`outbox_app.go:438-449,492-494`),只缺投递。测试 `TestDeregisterEnqueuesClearance`(`outbox_app_test.go:537-584`)仅覆盖项目维度,掩盖了该缺口。建议:clearance 增加团队 link × team 档直授的投递。
- **R2 purge 不投递反向清理且可对 active 应用执行**:`appmgmt.go:409-452` 无 enqueue、无状态前置;对 idp_role 应用直接 purge 会留下 IdP Role 壳成员(`user.app_roles` 清壳逻辑只在任务已被投递时生效,`outbox_app.go:580-584`);对 api_push 应用直接 purge 会留下应用侧成员行,且 link 行被删后迟到的 remove 任务按 "link missing" 跳过(`outbox_app.go:444-447,452-456`)。建议:purge 前强制 deregistered 状态,或在 purge 事务内补投 clearance(任务容错已能处理 link 缺失前的定位)。
- **R3 purge 无服务端确认/防误触**:见 §4、§7-差异②。物理删除不可逆,仅审计 `app.purge` 留痕。可接受(操作面为 role:admin+校级),但建议至少在响应或审计中记录 purge 时应用状态。
- **R4 `POST /api/apps/{code}/reconcile` 与 `GET /api/apps/{code}/permissions` 无服务层范围门**:reconcile 会触发对 IdP(GetRole)与应用侧(ListProjectMembers/ListTeamMembers)的出网调用,部门级 role:admin 可触发——与评审 A1 对 `idp-applications` 的处理口径不一致(`reconcile_app_dims.go:539-547,376-383` 均无 appAdminGate;`appmgmt.go:527-538` 同)。建议补 `appAdminGate`(permissions 只读风险低,可按需)。
- **R5 api_push 配置不校验形态**:api_base_url 无 URL scheme 校验(对照 IdpConsoleURL 有 http(s) 守卫,`hiedu/api/server.go:91-97`),坏配置静默进队列后转 manual;缓解:任务转人工 + `link.last_error` 可见(`outbox_app.go:144-182`)。
- **R6 默认 sync_mode 不一致**(轻微):前端表单默认 manual、后端空值默认 api_push(§7-差异④)。建议前端注释或后端对齐,避免第三方集成踩坑。
- **R7 目录 `Source=idp_sync` 未落地**(未核实到实现):`domain/app.go:61` 预留,当前仅写 `manual`;若后续做 IdP→目录自动同步,需补 managed→导入的闭环与缓存失效。
- **R8 注销/直授吊销依赖"投递先于吊销"的顺序约定**:`enqueueAppRoleClearance`/`enqueuePermRevokedMembers`/`enqueuePersonInvalidation` 必须在吊销前调用以借 active 直授定位人员(`appmgmt.go:373-378,501-507,1111-1118` 注释)。该顺序目前正确,但属隐式契约,后续改动需保持;对账维度③(`reconcile_app.go:17-22` 六类漂移)是兜底检出,只报告不修复。
- **R9 白名单缓存 TTL 30s 窗口**:注销/吊销后 `Invalidate` 在事务成功后调用(`appmgmt.go:393,457,522`),单实例无窗口;多实例部署下其他实例最长 30s 内仍可能把 revoked 目录行当 known 发放(缓存为进程级,`appmgmt.go:85-90`)。影响有限(权限点停发最终一致),如需强一致可改 org 版本号失效。

---

### 附:关键审计动作清单(便于前端/运维对照)

`app.register` / `app.deregister` / `app.purge` / `app.perm_upsert` / `app.project_link_upsert` / `app.unit_link_upsert` / `app.grant` / `app.grant_revoke` / `app.grants_revoked` / `app.owner_transfer_cascade` / `person.status`(均见 `hiedu/app/appmgmt.go` 对应方法);outbox 任务转人工审计 `outbox.manual`(`hiedu/app/outbox.go:205-210`)。sync_log 实体类型 `app` 覆盖四类 outbox 任务(`outbox.go:513-517`),对账差异 action:`reconcile.grant_drift` / `reconcile.link_drift` / `reconcile.role_drift`(`reconcile_app.go:27`、`reconcile_app_dims.go:25-26`)。
