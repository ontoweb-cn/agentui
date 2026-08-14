import { inspectorServer } from '@react-dev-inspector/vite-plugin';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { appName } from './src/conf.json';

// Inject code location data attributes for react-dev-inspector
const inspectorBabelPlugin = (): import('vite').Plugin => ({
  name: 'inspector-babel',
  enforce: 'pre' as const,
  async transform(code: string, id: string) {
    if (id.includes('node_modules')) return;
    if (!/\.[jt]sx$/.test(id)) return;

    // Dynamically import babel transform to inject data attributes
    const { transform } = await import('@react-dev-inspector/babel-plugin');
    return {
      code: transform({
        filePath: id,
        sourceCode: code,
      }),
      map: null,
    };
  },
});

type MinifyValue = boolean | 'esbuild' | 'terser';

function resolveMinify(value: string | undefined): MinifyValue {
  if (value === undefined) return 'terser';
  const lower = value.toLowerCase();
  if (lower === 'false') return false;
  if (lower === 'esbuild') return 'esbuild';
  if (lower === 'terser') return 'terser';
  return 'terser';
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from .env file (also loads .env.local, .env.[mode], .env.[mode].local)
  const env = loadEnv(mode, process.cwd(), '');

  // Backend proxy targets (configurable via env for remote/local dev)
  const apiHost = env.API_HOST || 'localhost';
  const pythonApiPort = env.PYTHON_API_PORT || '9380';
  const pythonAdminPort = env.PYTHON_ADMIN_PORT || '9381';
  const wargamePort = env.WARGAME_PORT || '9385';
  // wargame 可单独指向远程主机（不随 API_HOST），便于前端看板展示远程 wargame 资源
  const wargameHost = env.WARGAME_HOST || apiHost;
  const bffHost = env.BFF_HOST || 'localhost';
  const bffPort = env.BFF_PORT || '9390';

  console.log(`[vite.config] mode: ${mode}, API_HOST: ${apiHost}, BFF_HOST: ${bffHost}`);

  const proxy = {
    '/api/bff': {
      target: `http://${bffHost}:${bffPort}`,
      changeOrigin: true,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/api\/bff/, ''),
    },
    '/api/v1/admin': {
      target: `http://${apiHost}:${pythonAdminPort}`,
      changeOrigin: true,
      ws: true,
    },
    // cognitive-wargame SSE 事件流(独立服务,端口 9385,需禁用超时)
    // rewrite 去掉 /wargame 前缀,后端仍监听 /api/v1/events/*
    '/api/v1/wargame/events': {
      target: `http://${wargameHost}:${wargamePort}`,
      changeOrigin: true,
      timeout: 0,
      proxyTimeout: 0,
      rewrite: (path: string) => path.replace(/^\/api\/v1\/wargame/, '/api/v1'),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          proxyReq.setHeader('Connection', 'keep-alive');
          proxyReq.setHeader('Cache-Control', 'no-cache');
          proxyReq.setHeader('Accept', 'text/event-stream');
        });
      },
    },
    // cognitive-wargame REST 端点(独立服务,端口 9385,非 intellect-rag-app)
    // 统一前缀 /api/v1/wargame/*,与 intellect-rag-app 的 /api/v1/* 隔离
    // rewrite 去掉 /wargame 前缀,后端仍监听 /api/v1/*
    '/api/v1/wargame': {
      target: `http://${wargameHost}:${wargamePort}`,
      changeOrigin: true,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/api\/v1\/wargame/, '/api/v1'),
    },
    '/api': {
      target: `http://${apiHost}:${pythonApiPort}`,
      changeOrigin: true,
      ws: true,
    },
    '/v1': {
      target: `http://${apiHost}:${pythonApiPort}`,
      changeOrigin: true,
      ws: true,
    },
  };

  return {
    test: {
      globals: true,
    },
    define: {
      // Expose to client code via import.meta.env
      'import.meta.env.API_PROXY_SCHEME': JSON.stringify('python'),
      // cognitive-wargame SSE 直连地址(开发环境绕过 Vite proxy 直连后端)
      // 开发模式:import-analysis 会注入 import.meta.env 对象,define 键必须以 import.meta.env. 开头
      'import.meta.env.WARGAME_SSE_HOST': JSON.stringify(wargameHost),
      'import.meta.env.WARGAME_SSE_PORT': JSON.stringify(wargamePort),
      // Keep backward compatibility
      __API_PROXY_SCHEME__: JSON.stringify('python'),
    },
    plugins: [
      inspectorBabelPlugin(),
      react(),
      viteStaticCopy({
        targets: [
          {
            src: 'src/conf.json',
            dest: './',
          },
          {
            src: 'node_modules/monaco-editor/min/vs/',
            dest: './',
          },
        ],
      }),
      createHtmlPlugin({
        inject: {
          data: {
            title: appName,
          },
        },
      }),
      inspectorServer(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@agentui/canvas-plugin': path.resolve(__dirname, 'packages/canvas-plugin/src'),
        '@intellect-docs': path.resolve(__dirname, './docs'),
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
      },
      postcss: './postcss.config.js',
      preprocessorOptions: {
        less: {
          javascriptEnabled: true,
          additionalData: `
            @import "@/less/variable.less";
            @import "@/less/mixins.less";
          `,
          modifyVars: {
            hack: `true; @import "@/less/index.less";`,
          },
        },
      },
    },
    server: {
      port: Number(env.PORT) || 9391,
      strictPort: false,
      hmr: {
        overlay: false,
      },
      proxy,
      fs: {
        allow: [
          path.resolve(__dirname),
          path.resolve(__dirname, '../intellect'),
        ],
      },
    },
    assetsInclude: ['**/*.md'],
    base: env.VITE_BASE_URL,
    publicDir: 'public',
    cacheDir: './node_modules/.vite-cache',
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router',
        'axios',
        'lodash',
        'dayjs',
      ],
      exclude: [],
      force: false,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      assetsInlineLimit: 4096,
      experimentalMinChunkSize: 30 * 1024,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'EMPTY_BUNDLE') {
            return;
          }
          warn(warning);
        },
        output: {
          manualChunks(id) {
            // if (id.includes('src/components')) {
            //   return 'components';
            // }

            if (id.includes('src/locales/') && id.endsWith('.ts')) {
              const match = id.match(/src\/locales\/([^/]+)\.ts$/);
              if (match) {
                return `locale-${match[1]}`;
              }
            }

            if (id.includes('node_modules')) {
              if (id.includes('node_modules/d3')) {
                return 'd3';
              }
              if (id.includes('node_modules/ajv')) {
                return 'ajv';
              }
              if (id.includes('node_modules/@antv')) {
                return 'antv';
              }
              const name = id
                .toString()
                .split('node_modules/')[1]
                .split('/')[0]
                .toString();
              if (['lodash', 'dayjs', 'date-fns', 'axios'].includes(name)) {
                return 'utils';
              }
              if (['@xmldom', 'xmlbuilder '].includes(name)) {
                return 'xml-js';
              }
              return name;
            }
          },
          chunkFileNames: 'chunk/js/[name]-[hash].js',
          entryFileNames: 'entry/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        },
        plugins: [],
        treeshake: true,
      },
      minify: resolveMinify(env.VITE_MINIFY),
      terserOptions: {
        compress: {
          drop_console: true, // delete console
          drop_debugger: true, // delete debugger
          pure_funcs: ['console.log'],
        },
        mangle: {
          // properties: {
          //   regex: /^_/,
          // },
          properties: false,
        },
        format: {
          comments: false, // Delete comments
        },
      },
      sourcemap: env.VITE_BUILD_SOURCEMAP !== 'false',
      cssCodeSplit: true,
      target: 'es2015',
    },
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          strict: false,
          noImplicitAny: false,
          skipLibCheck: true,
        },
      },
    },
    entries: ['./src/main.tsx'],
  };
});
