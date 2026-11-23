# TC-RP1-02 hook 形态 schema + TC-RP1-04 揭示 hook + TC-RP1-05 组件级无效提交

> 组:ragflow-p1-batch / 前端 jest;隔离:jsdom,无网络
> 关联:手册 §2.2、§3.2;任务 T2.3、T2.8

## TC-RP1-02 useChatSettingSchema(renderHook,mock 沉重组件)

| # | 操作 | 预期 |
|---|---|---|
| 1 | AnySearch key ∈ {undefined,'',' ','x'} parse → removeUselessFieldsFromValues → safeParse 往返 | provider 保持 anysearch;key 保持;hasWebSearchProvider=true(keyless) |
| 2 | web_search_provider='' + 双 key 保留 parse 往返 | web_search_provider==='';hasWebSearchProvider=false |
| 3 | Search1API 无自身 key(有他人 key) | safeParse fail;issue path ['prompt_config','search1api_api_key'] |

## TC-RP1-04 useRevealSubmitErrors

| # | 操作 | 预期 |
|---|---|---|
| 1 | 初始渲染 | 四 section 全 false;scrollIntoView 0 次 |
| 2 | 点击 save(handleInvalidSubmit) | 四 section 全 true;scrollIntoView 1 次({behavior:'smooth',block:'center'});目标是首个错误指示元素 |
| 3 | 再点 save | scrollIntoView 2 次(信号计数器重复触发) |

## TC-RP1-05 ChatSettings 组件级无效提交(agentui 适配)

| # | 操作 | 预期 |
|---|---|---|
| 1 | 渲染 ChatSettings(data 含必填服务商无 key),点保存 | 高级设置 Collapse 展开(面板内容可见);FormMessage 渲染 webSearchApiKeyRequired;scrollIntoView 被调用 |

> 说明:jsdom 无布局,滚动为 mock 断言;真浏览器视觉走查 = TC-RP1-10(受限)。
> 回归修订日期:2026-11-22(首次建档)
