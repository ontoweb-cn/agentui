# 质量 + 安全评审 — 本会话未推送代码批

> 生成时间:2026-11-21 22:05
> 评审范围:`87d21e3..HEAD` 六提交(代码主体:e093794 向导 envSnippet / 77e0233 P1-b / d52889d EPERM 修复;22dce83 T1 批;0d467d5/d5a20b1 纯文档),另对已推送的 7de6206(T2.10)补一条安全建议
> 评审方法:逐块精读新增代码 + 与既有语义(rag-fetch explicit 分支、P1-a 401 透传、member 解析缓存)交叉核对 + 测试覆盖核对
> 结论:**1 个 P2(建议修复后再推)、5 个 P3、3 个信息项(其中 1 项涉 D2 决策耦合,必须在开启检查单中显式出现)**;测试与文档质量整体良好

## 一、发现总表

| # | 级别 | 位置 | 发现 |
|---|---|---|---|
| 1 | **P2** | `plugins.ts` 换入第二段 catch(L584-591) | copySwapFallback 失败路径缺回滚:dest 短暂缺失,打破"dest 任一时刻非空"核心不变式 |
| 2 | P3 | `plugins.ts` 第一段 catch | copySwapFallback 的 cp 中途失败 → retired 残留部分副本(不在 finally 清理范围;下次 install 预 rm 兜住) |
| 3 | P3 | `plugins.ts` L593 | 成功换入后 `rm(retired)` 若抛非 ENOENT(Windows 句柄)→ 已换入成功却 500;建议 catch 抑制 |
| 4 | P3 | `intellect-rag-client.ts` L114 | forceServiceToken=true 且 ragAdminToken 缺失(当前 proxy 不可达)→ 回落 session 分支且身份头已剥离的不一致态;建议注释固化不变式或防御断言 |
| 5 | P3 | `proxy.ts` L181 | 门控条件 `method !== 'GET'` 覆盖 HEAD/OPTIONS:HEAD 读路径在 flag 开启时也 403;同源部署无实际 CORS preflight 影响,建议白名单 `['GET','HEAD']` |
| 6 | P3 | `fs-windows-retry.ts` L36 | 函数体内动态 `import('node:fs/promises')` 无必要(静态 import 同样可被 vi.mock 拦截),每调用一次模块解析开销;风格突兀 |
| 7 | 信息(安全/设计内) | `proxy.ts` L172 | flag 开启后 **GET 也强制服务令牌** → 普通成员读范围从"成员可见"升为"租户全量"——该权限提升即 D2"读+写"决策本体;flag 默认关 ✓,但**开启检查单必须显式含 D2 拍板**,否则静默提权 |
| 8 | 信息 | `proxy.ts` L241 | forceServiceToken 时 401 透传条件仍看 sessionToken(P1-a 语义):服务令牌 401 也会透传——企业模式拦截器静默,错误在模型页可见,方向与 P1-a 错误可见化一致;社区模式(sessionToken 无)保持改写,无登出循环。语义自洽,建议注释补一句"服务令牌 401 同样透传" |
| 9 | 信息(安全,对已推送 T2.10) | `bff-agents.ts` PATCH L253-267 | `title`/`prompt_config` 无长度/体积上限(仅类型/数组过滤):认证成员可提交超大 prompt_config 落 Gateway DB。建议 BFF 加上限(如 title ≤200 字符、prompt_config ≤256KB)或确认 Gateway 侧体积约束 |

## 二、P2 详述与修复建议(#1)

**路径**:`plugins.ts` L584-591。第二段 rename(staging→dest) 重试穷尽后走 `copySwapFallback(staging, dest)`;当兜底自身抛错(cp 失败如 ENOSPC / rm staging 失败)时,错误直接上抛——而此刻 **dest 已被移走到 retired、新副本也被回滚删除**,dest 处于"空位"直到下次 install 预清理。对比:同函数非重试分支有 `rename(retired, dest)` 回滚,重试分支没有。

**修复建议**(保持不变式,~6 行):

```ts
} catch (error) {
  if (isRetriableFsError(error)) {
    try {
      await copySwapFallback(staging, dest);
    } catch (swapErr) {
      if (hadPrevious) {
        await rename(retired, dest).catch(() => {});
      }
      throw swapErr;
    }
  } else { ... }
}
```

**测试补充**:copySwapFallback 二次抛错 → 断言 rename(retired→dest) 被调、最终上抛 swapErr(mock 层面)。

## 三、已核实无问题的部分

- **fail-closed 门控语义**:role 解析失败(catch 静默跳过/resolver 兜底 'member')→ `intellectRole ?? ''` 不在 ADMIN_ROLES → 403 ✓;60s 缓存使 TEAM 抖动只造成最长 60s 的误拒窗口 ✓
- **路径匹配方向安全**:RE 不匹配的路径只会"不强制服务令牌"(成员令牌 + 上游自主鉴权),不存在借大小写/编码绕过获得服务令牌的方向;`..` 路径遍历预检保留 ✓
- **explicit 分支交互**:forceServiceToken 显式 Authorization 后,fetchWithRagToken 不覆盖不重试(rag-fetch L98-100)✓;sessionToken 仍在 options 但优先级低于 explicit ✓
- **flag 语义**:`=== 'true'` 精确匹配、默认关、注释含回滚与开启前置(D2)✓
- **D-FUP-01 向导修复**:envSnippet 服务端永为占位符(`<your-token>`/`<your-secret>`),完成页渲染无密钥泄露;stateSecret 仅会话内存态 ✓
- **T1 批**:chat.ts 类型放宽零涟漪(全仓单读点);zh/en 死键删除不影响其他语言(ar/bg/fr 残留键无消费者,L-06 已登记);provenance 注释纯注释 ✓
- **测试卫生**:新用例均 stub global fetch 无真实网络;`BFF_MODEL_MGMT_SERVICE_TOKEN` 在 beforeEach/afterEach 双清,无跨用例泄漏;fs-windows-retry.test 对 node:fs/promises 整体 mock,隔离干净 ✓

## 四、建议动作序

1. ~~修复 #1(P2)+ 补 1 例单测 → 随本批一起推送(阻塞推送)~~ **已修复(见 §五)**
2. ~~#3/#4/#5 三个一行级加固可并入同一个小提交~~ **已修复(见 §五;#2 一并加固)**
3. ~~#9 建议在 T2.7 一并实现体积上限~~ **已提前实现(BFF 兜底上限,T2.7 保留 provider↔key 校验职责)**
4. ~~#7 写入 P1-b flag 的"生产开启检查单"~~ **已落实**(`model-provider-p1b-remaining-analysis.md` §5.1,五项检查单)

## 五、修复记录(2026-11-21,同日闭环)

| # | 处置 | 证据 |
|---|---|---|
| 1 (P2) | 第二段兜底失败路径补 `rename(retired→dest)` 回滚后再抛;retired→retired 兜底失败路径补 retired 部分副本清理(#2 并入) | plugins.ts 换入段;**新增回归测试** `plugins-swap-rollback.test.ts`:真实首装 → 第二次安装模拟 rename EPERM + 兜底抛错 → 断言 dest 恢复旧装、瞬态目录清空、500 上抛 |
| 2 (P3) | 并入 #1 修复 | 同上 |
| 3 (P3) | 成功换入后 `rm(retired)` 包 try/catch 抑制,注释说明瞬态目录兜底 | plugins.ts |
| 4 (P3) | client 侧固化调用方不变式注释(forceServiceToken 必须伴随 ragAdminToken) | intellect-rag-client.ts |
| 5 (P3) | 门控读语义白名单 `GET/HEAD`(`isReadMethod`) | proxy.ts;proxy.test 24/24 回归绿 |
| 6 (P3) | 动态 import 改静态 | fs-windows-retry.ts;vi.mock 拦截不受影响(6/6 绿) |
| 7 (信息) | 生产开启检查单五项写入 `model-provider-p1b-remaining-analysis.md` §5.1(D2 拍板列首位) | 文档 |
| 8 (信息) | 401 透传处补注释:服务令牌 401 同样透传及理由 | proxy.ts |
| 9 (信息) | **BFF 兜底上限已实现**:title ≤200 字符、kb_ids ≤100 项、prompt_config 序列化 ≤256KB,超限 400;新增 4 例测试(含边界值放行) | bff-agents.ts PATCH;bff-agents.test.ts |

门禁:`tsc --noEmit` 干净;受影响 5 文件 117/117 + fs-windows-retry 6/6 + proxy 24/24 全绿;BFF 全量另跑(见提交信息)。
