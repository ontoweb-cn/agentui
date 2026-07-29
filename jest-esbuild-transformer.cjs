// Jest transformer wrapper：包装 esbuild-jest，预处理 import.meta.env 和
// import.meta.glob。
//
// 背景：
// 1. import.meta.env：esbuild-jest 调用 esbuild.transformSync 时使用
//    format: 'cjs'，在 cjs format 下 esbuild 会把 import.meta 转换为一个
//    空 helper 对象，导致 import.meta.env 为 undefined。本 wrapper 在源码
//    进入 esbuild 前用正则把 import.meta.env 替换为 process.env，配合
//    jest-setup-env.ts 注入的 Vite 默认环境变量生效。
//
// 2. import.meta.glob：Vite 编译时 API，Jest 无法运行时模拟。当检测到
//    源码含 import.meta.glob 时，先用 Babel + babel-plugin-import-meta-glob
//    静态解析为 require() 对象字面量，再交给 esbuild-jest 处理。
//    需搭配 @babel/preset-typescript 解析 TS 语法（含泛型调用
//    import.meta.glob<{ default: T }>(...)）。
//
// 两条路径互补：
//   - 无 import.meta.glob：仅正则替换 env（快路径）
//   - 有 import.meta.glob：正则替换 env + Babel 转换 glob（慢路径）
//
// babel.config.cjs 中的 replaceImportMetaEnv plugin 处理含 jest.mock 的
// 文件（esbuild-jest 会先用 babel 预处理这些文件以支持 mock hoisting），
// 本 wrapper 处理其他文件，两者互补。
const esbuildJest = require('esbuild-jest');
const babel = require('@babel/core');
const importMetaGlobPlugin = require('./babel-plugin-import-meta-glob.cjs');

const createTransformer = (options) => {
  const inner = esbuildJest.createTransformer(options);
  const transformerOpts = options || {};
  const pluginOpts = {
    aliases: transformerOpts.aliases || { '@': '<rootDir>/src' },
    rootDir: transformerOpts.rootDir,
  };

  return {
    canInstrument: true,
    process(content, filename, config, opts) {
      // 1. 替换 import.meta.env → process.env（正则，快）
      let code = content.replace(/\bimport\.meta\.env\b/g, 'process.env');

      // 2. 检测到 import.meta.glob 时跑 Babel 静态转换
      if (code.includes('import.meta.glob')) {
        const result = babel.transformSync(code, {
          filename,
          babelrc: false,
          configFile: false,
          presets: [
            ['@babel/preset-typescript', { allExtensions: true, isTSX: true }],
          ],
          plugins: [[importMetaGlobPlugin, pluginOpts]],
          // 保留 ES module 语法（import/export），让 esbuild-jest 后续处理
          // module 转换（format: 'cjs'）。若此处转成 cjs，esbuild 再转一次
          // 可能出问题。
          sourceType: 'unambiguous',
        });
        code = result.code;
      }

      return inner.process(code, filename, config, opts);
    },
  };
};

module.exports = {
  createTransformer,
  canInstrument: true,
};
