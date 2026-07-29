import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      // 自定义 wrapper：包装 esbuild-jest，预处理 import.meta.env 和
      // import.meta.glob。详见 jest-esbuild-transformer.cjs 注释。
      // aliases 传给 babel-plugin-import-meta-glob，用于解析 @/ 等别名
      // pattern（<rootDir> 占位符由插件内部按源文件路径推导）。
      '<rootDir>/jest-esbuild-transformer.cjs',
      {
        sourcemap: true,
        loaders: {
          '.ts': 'tsx',
        },
        aliases: {
          '@': '<rootDir>/src',
        },
      },
    ],
  },
  moduleNameMapper: {
    // 注：原 @/features/_registry 和 @/components/svg-icon 的 mock 重定向
    // 已移除——jest-esbuild-transformer.cjs 通过 babel-plugin-import-meta-glob
    // 静态解析 import.meta.glob 调用，真实模块逻辑被执行。
    '^@/(.*)$': '<rootDir>/src/$1',
    '^human-id$': '<rootDir>/__mocks__/human-id.js',
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
    '\\.(jpg|jpeg|png|gif|svg|webp)$': '<rootDir>/__mocks__/fileMock.js',
  },
  // setupFiles 在 transform 后、测试运行前执行
  // 注入 Vite 环境变量默认值到 process.env
  setupFiles: ['<rootDir>/jest-setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx,js,jsx}',
    '!src/.umi/**',
    '!src/.umi-test/**',
    '!src/.umi-production/**',
    '!**/*.d.ts',
    '!coverage/**',
    '!dist/**',
    '!config/**',
    '!mock/**',
  ],
  coverageThreshold: {
    global: {
      lines: 1,
    },
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    // BFF 使用 vitest 运行测试（见 bff/package.json scripts.test），不应被 Jest 加载
    '/bff/',
  ],
};

export default config;
