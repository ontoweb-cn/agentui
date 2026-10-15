// 冻结产物:模拟"v1.0 代 SDK 构建的老插件"(手写自包含 ESM,不随宿主演进重建)。
// 兼容基线用途见同目录 README 与 src/plugins/__tests__/compat-fixture.test.ts。
// **变更本文件 = 生成新一代基线**:必须先在 README 记录日期与所依据的 SDK 版本,
// 并同步更新 app.json 的 apiVersion 声明。
window.AgentUI.registerApp({
  id: 'compat-fixture',
  mount(el) {
    const div = document.createElement('div');
    div.setAttribute('data-compat-fixture', '1');
    div.textContent = 'compat-fixture';
    el.appendChild(div);
    return () => {
      div.remove();
    };
  },
});
