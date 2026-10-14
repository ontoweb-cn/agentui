import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 插件产物约束(docs/plugin-development-guide.md §4):
 * - lib 单文件 ESM(inlineDynamicImports):产物一个 index.js,同源动态 import;
 * - 自包含:不配 external,全部依赖打进产物(React 也自带——宿主双 root 模型);
 * - 顶层目录必须 ∈ {ui, assets, dist}(BFF 安装白名单),故 outDir=ui/dist。
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'ui/dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
