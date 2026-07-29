// Babel 配置：仅用于 Jest 测试环境（生产构建用 Vite + esbuild，不走 babel）。
//
// 文件扩展名必须是 .cjs：package.json 设置了 "type": "module"，
// .js 会被当作 ESM 处理，无法使用 module.exports。
//
// 背景与方案：
// 1. esbuild-jest 在检测到 jest.mock 调用时会用 babel 预处理代码以支持
//    mock hoisting（见 node_modules/esbuild-jest/esbuild-jest.js 中
//    `if (sources.code.indexOf("ock(") >= 0)` 分支）。esbuild-jest 内部只
//    配置了 @babel/plugin-transform-modules-commonjs，未配置 TypeScript
//    preset，导致 import 的 binding 同时出现在类型注解时报错
//    "Cannot transform the imported binding ... since it's also used in a
//    type annotation"。本配置补充 @babel/preset-typescript 修复。
//
// 2. esbuild-jest 调用 esbuild.transformSync 时未传递 define 选项
//    （见 node_modules/esbuild-jest/esbuild-jest.js 中 transformSync 调用），
//    所以 jest.config.ts 中的 `define: { 'import.meta.env': 'process.env' }`
//    不生效。本配置用自定义 babel plugin 在 babel 预处理阶段把
//    `import.meta.env` 替换为 `process.env`，使 `import.meta.env.VITE_XXX`
//    变成 `process.env.VITE_XXX`，配合 jest-setup-env.ts 注入的默认值生效。
//
// 注：仅含 jest.mock 的文件会触发 babel 预处理，其他文件由 esbuild 直接
// 转译（esbuild 原生支持 import.meta），不影响正常测试。
module.exports = {
  presets: [
    ['@babel/preset-typescript', { allExtensions: true, isTSX: true }],
  ],
  plugins: [
    function replaceImportMetaEnv({ types: t }) {
      // 替换 import.meta.env → process.env
      // 匹配 MemberExpression 形如 `import.meta.env`（不含后续 .XXX 访问）
      return {
        visitor: {
          MemberExpression(path) {
            const { node } = path;
            if (
              t.isMemberExpression(node) &&
              t.isMemberExpression(node.object) &&
              t.isMetaProperty(node.object.object) &&
              node.object.object.meta.name === 'import' &&
              node.object.object.property.name === 'meta' &&
              node.object.property.name === 'env'
            ) {
              // 把 `import.meta.env` 子表达式替换为 `process.env`
              node.object.replaceWith(
                t.memberExpression(
                  t.identifier('process'),
                  t.identifier('env'),
                ),
              );
            }
          },
        },
      };
    },
  ],
};
