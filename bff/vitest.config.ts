import { defineConfig } from 'vitest/config';

// Multi-Harness P1:Vitest 配置(research.md §4 P1 硬前置)
// BFF 是 Node.js 服务,测试环境用 node(非 jsdom)。
// 测试文件与源码同目录(__tests__ 子目录),便于维护。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 不watch,CI 友好;本地开发可加 --watch 覆盖
    watch: false,
    // 不污染全局,显式 import { describe, it, expect } from 'vitest'
    globals: false,
  },
});
