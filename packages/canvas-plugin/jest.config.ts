import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
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
      'esbuild-jest',
      {
        sourcemap: true,
        loaders: {
          '.ts': 'tsx',
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
