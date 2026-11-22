# oxlint 策略(T2.6 / 收紧)

> 2026-11-22。裁决:**不替换 eslint**;`npm run lint` = eslint + oxlint 并行。

## 裁决

- eslint 继续作为样式/React hooks 等规则源;
- oxlint 作快速 unicorn/基础规则补充,目标把 warning 压到个位数;
- 不将 oxlint error 级规则在未清库存前升为 CI 硬失败(当前 warning 出口码仍为 0)。

## 本批

- 清理可安全修复的 `no-useless-rename` / `no-useless-fallback-in-spread` / `no-new-array` / 死代码 `false &&`;
- **保留**:`src/components/ui/`(共享锁)、`jsonjoy-builder` 的 thenable/unused(上游组件债,另立项)。
