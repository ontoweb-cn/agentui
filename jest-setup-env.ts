// Jest 测试环境变量初始化（在所有测试文件 transform 后、运行前执行）。
//
// 配合 jest-esbuild-transformer.cjs：transformer 在源码进入 esbuild 前
// 把 `import.meta.env` 替换为 `process.env`，所以测试代码中
// `import.meta.env.VITE_XXX` 实际变成 `process.env.VITE_XXX`。
// 此处向 process.env 注入 Vite 默认值，确保测试能正常访问。
//
// 同时补充 jsdom 环境缺失的全局变量（React Router 7 依赖 TextEncoder）。

import { TextEncoder, TextDecoder } from 'util';

// Vite 环境变量默认值
process.env.VITE_DEFAULT_LANGUAGE_CODE =
  process.env.VITE_DEFAULT_LANGUAGE_CODE || 'en';
process.env.VITE_BASE_URL = process.env.VITE_BASE_URL || '/';
process.env.VITE_INTELLECT_ENTERPRISE =
  process.env.VITE_INTELLECT_ENTERPRISE || '';
process.env.DEV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// jsdom 环境不暴露 TextEncoder/TextDecoder，但 React Router 7 依赖它们
// （内部用 TextEncoder 做 URL 编码）。从 Node.js util 模块补到全局。
if (typeof (globalThis as any).TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = TextEncoder;
}
if (typeof (globalThis as any).TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = TextDecoder;
}
