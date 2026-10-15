# plugin-compat-fixture(跨版本兼容基线夹具)

**用途**:机制化回答"用老 SDK 构建的插件,在新宿主上还能不能装载"(canvas 阶段 4 spec §七 R3 / 差距 G7)。本包产物是**冻结的**——模拟一个停留在 v1.0 代 SDK 的插件,不随宿主或 SDK 升级重建。

## 组成

| 文件 | 说明 |
|---|---|
| `app.json` | 声明 `apiVersion: "^1.0.0"`(老一代 SDK 的兼容声明) |
| `ui/dist/index.js` | 手写自包含 ESM 产物,经 `window.AgentUI.registerApp` 注册——**冻结,禁止随手改** |
| (测试) | `src/plugins/__tests__/compat-fixture.test.ts`:宿主侧判定该声明兼容 + 产物形态正确 |

## 宿主发版时的纪律

1. 根 jest 全量必须包含 `compat-fixture.test.ts` 且绿——红了 = 当前宿主**破坏了 v1.0 代的装载契约**,发版前必须修复或 bump `HOST_API_VERSION` major 并评估存量插件公告;
2. 需要模拟"新一代老插件"(如 v1.3 代)时:复制本包改名(如 `plugin-compat-fixture-v13`),按当时 SDK 版本重建产物并记录日期,**不要原地覆盖** v1.0 基线;
3. 长期形态:宿主 CI 增加真实装载断言(经 BFF 文件路由动态 import 夹具产物),当前为注册/兼容判定层断言(S1 范围)。
