# Route B 第二阶段代码评审 — Q11 / 右侧工作区 / Q7b / Q12

> **评审对象**:2026-10-18 第二阶段改动(`git diff` + 新增文件)
> **范围**:ActivityTree 50 条上限、右侧 Workspace、RAG 失败终态、Storybook Token
> **结论**:**通过**。未发现阻断性安全漏洞;评审中修复 9 项质量项
> (逐 token 父级重渲染、RAG abort 竞态、blob URL 泄漏、tabs 键盘导航、下载按钮 i18n、
> showAll 跨 turn 重置、aria-controls、下载类型/失败提示、按 id 去重);
> QP7(虚拟化)经评审裁决为“50 条上限 + Show more/less”的可接受设计。

---

## 一、评审范围

| 类别 | 文件 |
|---|---|
| 活动树 | `src/components/message-item/activity-tree.tsx`、`src/components/message-item/__tests__/activity-tree.test.tsx` |
| 右侧工作区 | `src/pages/next-chats/chat/workspace/workspace-panel.tsx`、`workspace/__tests__/workspace-panel.test.tsx` |
| 页面接入 | `src/pages/next-chats/chat/index.tsx`、`chat-box/single-chat-box.tsx` |
| 复用组件 | `src/components/next-message-item/uploaded-message-files.tsx`、`src/components/document-download-button/index.tsx` |
| RAG 终态 | `src/hooks/logic-hooks.ts`、`src/hooks/__tests__/use-send-message-with-sse.test.ts` |
| Storybook | `.storybook/main.ts`、`.storybook/preview.ts`、`package.json` |

---

## 二、安全评审

| # | 检查项 | 结论 | 说明 |
|---|---|---|---|
| S1 | XSS / DOM 注入 | ✅ 安全 | Workspace 中文件名、文档名、MIME 均作为 React 文本节点渲染;无 `dangerouslySetInnerHTML`/`innerHTML` |
| S2 | 下载链路 | ✅ 无新增面 | `DocumentDownloadButton` 继续走既有 `downloadAgentFile({docId, ext})`,docId 来自消息数据,不构造任意 URL |
| S3 | 文档预览 | ✅ 无新增面 | `ReferenceDocumentList` 复用既有 `PdfDrawer` + docId;workspace 未新增预览协议 |
| S4 | 本地文件预览 | ✅ 安全 | `File` 使用 `URL.createObjectURL` 生成本地 blob URL;仅用于 `<img src>`;本轮补了 revoke(见 QP3) |
| S5 | 网络/存储 | ✅ 无新增 | 未新增 fetch/localStorage/token;workspace 仅在内存中聚合 `messages` |
| S6 | 依赖供应链 | ✅ 可控 | 新增 devDependency `less-loader@12.2.0`,仅 Storybook 构建期使用,不进生产 bundle |
| S7 | 构建期代码执行 | ✅ 可控 | less-loader 仅编译仓库内 `variable.less`;无远程 less 输入 |
| S8 | 日志泄露 | ⚠️ 既有 | `document-download-button` 下载失败 `console.error`、`single-chat-box`/`chat/index` 既有 console;未新增敏感信息输出 |
| S9 | 权限/越权 | ✅ 无变化 | 未改鉴权、路由守卫、BFF 契约 |
| S10 | DoS/渲染资源 | ✅ 已缓解 | ActivityTree 单次最多渲染 50 个工具;Workspace 仅在打开时回传消息并 500ms 合并 |

**安全结论**:无阻断性问题;workspace 复用既有受控下载/预览链路,未引入新的外部输入面。

---

## 三、质量评审

### 3.1 评审中已修复

| # | 严重度 | 问题 | 修复 | 验证 |
|---|---|---|---|---|
| QP1 | 中 | 工区打开时每个流式 token 都触发 `onMessagesChange` → Chat 页整树重渲染 | 打开瞬间同步一次;流式期间 `useDebounceEffect` 500ms 合并 | tsc/Jest |
| QP2 | 中 | RAG abort 时 `response.clone().json()` 可能抛非 `DOMException`,被误判为 failed | 外层 catch 同时检查 `sseRef/controller.signal.aborted`;新增 abort 测试 | 3 个 hook 测试通过 |
| QP3 | 中 | `UploadedMessageFiles` 每次 render 调用 `URL.createObjectURL` 且不 revoke | 抽 `LocalImagePreview`,`useMemo` 创建 + `useEffect` 清理 revoke | tsc/build |
| QP4 | 低 | Workspace tabs 无方向键导航 | 补 ArrowLeft/Right + roving tabindex;新增键盘测试 | 6 个 workspace 测试 |
| QP5 | 低 | `DocumentDownloadButton` 按钮文案硬编码英文 | 改用 `t('common.download')` | tsc |
| QP6 | 低 | ActivityTree 上一轮 `showAll` 可能绕过 50 条上限 | 新 turn(`isStreaming` 变 true)重置 `showAll` | 测试通过 |
| QP8 | 低 | Workspace 非激活 tab 的 `aria-controls` 指向未渲染的 panel | 仅激活 tab 设置 `aria-controls`;新增断言 | 测试通过 |
| QP9 | 低 | 下载类型标签英文、失败只 console.error | 类型改为扩展名大写(语言中立);失败补 `toast.error(t('common.downloadFailed'))` | tsc/lint |
| QP10 | 低 | Workspace 按 name+size 去重,同名同大小文件会合并 | 服务端文件优先按稳定 `id` 去重;本地 File 仍用 name+size;新增测试 | 测试通过 |

### 3.2 已裁决 / 仍遗留

| # | 结论 | 说明 |
|---|---|---|
| QP7 | **裁决:不引入虚拟列表** | ActivityTree 嵌在聊天滚动区内,再套内部虚拟滚动会产生嵌套滚动冲突;50 条上限 + Show more/less 已能约束 DOM。若未来单 turn 工具数常态 >100,再评估独立滚动容器 + 虚拟化 |

---

## 四、验证

| 检查 | 结果 |
|---|---|
| `npx jest` 全量 | **670 passed / 44 suites** |
| `npx tsc --noEmit` | 通过 |
| `npx eslint <changed files>` | **0 error**;既有 console warning 保留 |
| `npm run build` | 通过(仅既有 chunk size warning) |
| `npm run build-storybook` | 通过;Token 与 TRAE-Work 故事可索引 |
| 新测试 | workspace 6 例、RAG hook 3 例、ActivityTree 上限 1 例 |

---

## 五、结论

- **安全**:无阻断性问题;workspace 未新增外部输入/下载/预览面。
- **质量**:QP1-QP6、QP8-QP10 已修复;QP7 经裁决采用 50 条上限 + Show more/less,不引入虚拟列表。
- **评审后状态**:无代码评审遗留;可合入当前分支。
