import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../../src/$1',
    '^@agentui/canvas-plugin/(.*)$': '<rootDir>/src/$1',
    '^@agentui/canvas-plugin$': '<rootDir>/src/index.ts',
    '\\.(css|less|scss|sass)$': '<rootDir>/../../__mocks__/styleMock.js',
    '\\.(jpg|jpeg|png|gif|svg|webp)$': '<rootDir>/../../__mocks__/fileMock.js',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      // 复用主项目的 jest-esbuild-transformer wrapper，统一处理
      // import.meta.env 和 import.meta.glob。canvas-plugin 测试会通过
      // @/ 别名（映射到 <rootDir>/../../src）transitively import 主项目的
      // _registry.ts / svg-icon.tsx，这些文件使用 import.meta.glob，需要
      // wrapper 进行静态转换。
      '<rootDir>/../../jest-esbuild-transformer.cjs',
      {
        sourcemap: true,
        loaders: {
          '.ts': 'tsx',
        },
        // canvas-plugin 的 @ 别名映射到 <rootDir>/../../src（即项目根的 src/）
        aliases: {
          '@': '<rootDir>/../../src',
        },
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/../../jest-setup.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;
