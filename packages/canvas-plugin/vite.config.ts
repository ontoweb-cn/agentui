import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// vite config 由 esbuild 打包加载,相对 TS 源码导入会被内联;
// 不走 '@agentui/plugin-sdk/host' 包名(node_modules 无 workspace 链接)
import {
  AGENTUI_SHARED_GLOBAL_KEY,
  SHARED_UI_MODULE_KEYS,
} from '../plugin-sdk/src/host';

// Tier B 独立构建(canvas-stage4-independent-build-spec.md §9.1/§9.2):
// 单例外部化 + 非单例打包复制。外部化面 = SHARED_API_VERSION 契约
// (react/react-dom/query/jsx-runtime/router/react-i18next/i18next/
// locales-config/theme-provider + 33 个 ui 白名单模块),产物把这些模块的
// import 重写为 window.__AGENTUI_SHARED__.<slot> 解构——与宿主同 module
// 实例(context/QueryClient/i18n/Router 逐位一致);其余宿主源码(@/ 别名
// 非单例部分)构建期读入打包,纯类型(erased)零产物影响。

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SHARED_PREFIX = 'agentui-shared:';

/** 外部化模块 → 共享面槽位路径(resolveId 拦截源字符串,先于 alias)。 */
const SHARED_SLOTS: Record<string, string> = {
  react: 'react',
  'react-dom': 'reactDom',
  'react-dom/client': 'reactDomClient',
  'react/jsx-runtime': 'jsxRuntime',
  '@tanstack/react-query': 'reactQuery',
  'react-router': 'router',
  'react-i18next': 'reactI18next',
  '@radix-ui/react-tooltip': 'radixTooltip',
  i18next: 'i18n',
  '@/locales/config': 'i18nModule',
  '@/components/theme-provider': 'themeProvider',
};
for (const key of SHARED_UI_MODULE_KEYS) {
  SHARED_SLOTS[`@/components/ui/${key}`] = `ui.${key}`;
}

function slotAccessor(slotPath: string): string {
  const parts = [AGENTUI_SHARED_GLOBAL_KEY, ...slotPath.split('.')].map((s) =>
    JSON.stringify(s),
  );
  return 'globalThis' + parts.map((p) => `[${p}]`).join('');
}

// 解析级外部化:宿主源码存在相对路径导入白名单单例的形态(如
// components/file-uploader 的 '../ui/tooltip'),仅按导入写法映射会漏网,
// 打包副本的 radix context 与宿主分裂(真机冒烟实锤:TooltipProvider 报错)。
// 此表按「解析后的宿主文件绝对路径」匹配,与导入写法无关。
const HOST_SRC = resolve(__dirname, '../../src');
const resolvedFileSlots = new Map<string, string>();
function registerResolvedSlot(absNoExt: string, slot: string) {
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const candidate = absNoExt + ext;
    if (existsSync(candidate)) {
      resolvedFileSlots.set(candidate, slot);
    }
  }
}
for (const key of SHARED_UI_MODULE_KEYS) {
  registerResolvedSlot(join(HOST_SRC, 'components/ui', key), `ui.${key}`);
}
registerResolvedSlot(join(HOST_SRC, 'components/theme-provider'), 'themeProvider');
registerResolvedSlot(join(HOST_SRC, 'locales/config'), 'i18nModule');

let sharedTmpCounter = 0;

/** import 子句 → 共享面解构语句(default/namespace 绑定整个 namespace,
 * named 剥离 type 声明后解构;与 ESM 语义的偏差仅为多一层属性访问)。 */
function rewriteImportClause(clause: string, slotPath: string): string {
  const tmp = `__agentuiShared${sharedTmpCounter++}`;
  const stmts: string[] = [`const ${tmp} = ${slotAccessor(slotPath)};`];
  let rest = clause;

  const namespace = rest.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) {
    stmts.push(`const ${namespace[1]} = ${tmp};`);
    rest = rest.replace(namespace[0], '');
  }
  const named = rest.match(/\{([\s\S]*?)\}/);
  if (named) {
    rest = rest.replace(named[0], '');
  }
  const defaultImport = rest.match(/([A-Za-z_$][\w$]*)/);
  if (defaultImport) {
    // i18nModule 等模块 namespace 的 default 才是宿主默认导出实例
    // (config.default = i18next 实例);react 等 namespace 无 default,
    // 回退绑定整个 namespace(与 ESM interop 语义一致)。
    stmts.push(`const ${defaultImport[1]} = ${tmp}.default !== undefined ? ${tmp}.default : ${tmp};`);
  }
  if (named) {
    const parts = named[1]
      .split(',')
      .map((spec) => spec.trim().replace(/^type\s+/, ''))
      .filter(Boolean)
      .map((spec) => {
        const m = spec.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!m) return null;
        return m[2] ? `${m[1]}: ${m[2]}` : m[1];
      })
      .filter((p): p is string => p !== null);
    if (parts.length > 0) {
      stmts.push(`const { ${parts.join(', ')} } = ${tmp};`);
    }
  }
  return stmts.join(' ');
}

/**
 * 外部化插件:resolveId 把外部化模块标记为 external(虚拟 id
 * `agentui-shared:<slot>`),renderChunk 在产物 ESM 上把对应 import 语句
 * 重写为共享面解构(此阶段 JSX 运行时注入的 react/jsx-runtime 导入已在场)。
 */
function tierBSharedExternals(): Plugin {
  return {
    name: 'tier-b-shared-externals',
    enforce: 'pre',
    resolveId(source, importer) {
      const slot = SHARED_SLOTS[source];
      if (slot) {
        return { id: SHARED_PREFIX + slot, external: true };
      }
      // CJS 互操作(@rollup/plugin-commonjs 对 require(外部化 id) 生成
      // '<id>?commonjs-external' 代理导入):透传 external,renderChunk
      // 重写时容忍可选 query。
      if (source.startsWith(SHARED_PREFIX)) {
        return { id: source, external: true };
      }
      // 解析路径匹配:vite:alias 先于本插件把 '@/xxx' 解析为无扩展名绝对
      // 路径,相对导入也会在后续解析——两类形态都按候选扩展名对表。
      const base = source.split('?')[0];
      if (base.startsWith('/') || (source.startsWith('.') && importer)) {
        const abs = base.startsWith('/')
          ? base
          : resolve(dirname(importer), base);
        const candidates = [
          abs,
          `${abs}.ts`,
          `${abs}.tsx`,
          `${abs}/index.ts`,
          `${abs}/index.tsx`,
        ];
        for (const candidate of candidates) {
          const resolvedSlot = resolvedFileSlots.get(candidate);
          if (resolvedSlot) {
            return { id: SHARED_PREFIX + resolvedSlot, external: true };
          }
        }
      }
      return null;
    },
    renderChunk(code) {
      if (!code.includes(SHARED_PREFIX)) {
        return null;
      }
      // 形态 1:裸副作用导入(树摇后 named 全消时 rollup 保留 side-effect 导入)
      let rewritten = code.replace(
        new RegExp(
          `import\\s*['"]${SHARED_PREFIX}([^'"]+?)(?:\\?[^'"]*)?['"];?`,
          'g',
        ),
        (_full, slotPath: string) => `${slotAccessor(slotPath)};`,
      );
      // 形态 2:default/namespace/named 子句导入(子句排除 ';',防止跨语句吞并)
      rewritten = rewritten.replace(
        new RegExp(
          `import\\s+([^;]*?)\\s*from\\s*['"]${SHARED_PREFIX}([^'"]+?)(?:\\?[^'"]*)?['"];?`,
          'g',
        ),
        (_full, clause: string, slotPath: string) =>
          rewriteImportClause(clause, slotPath),
      );
      if (rewritten.includes(SHARED_PREFIX)) {
        throw new Error(
          '[tier-b-shared-externals] 存在未重写的外部化引用(export-from 或动态 import 不支持):' +
            rewritten.slice(Math.max(0, rewritten.indexOf(SHARED_PREFIX) - 120)),
        );
      }
      return { code: rewritten, map: null };
    },
  };
}

/**
 * i18n JSON 发射:canvas 词条单源为 TS(src/i18n/{zh,en}.ts,纯对象字面量),
 * 构建时转成 ui/locales/{zh,en}.json 供 app.json i18n.files 声明——
 * BFF 列表接口内联下发,宿主 injectPluginI18n 注入(Tier A 同路径)。
 */
function emitI18nJson(): Plugin {
  return {
    name: 'canvas-i18n-json',
    apply: 'build',
    closeBundle() {
      for (const lang of ['zh', 'en']) {
        const source = readFileSync(
          resolve(__dirname, `src/i18n/${lang}.ts`),
          'utf-8',
        ).replace(/^\s*export\s+default/, 'return');
        const data = new Function(`${source};`)() as unknown;
        const outDir = resolve(__dirname, 'ui/locales');
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          join(outDir, `${lang}.json`),
          JSON.stringify(data, null, 2) + '\n',
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tierBSharedExternals(), emitI18nJson()],
  resolve: {
    alias: {
      // 必须先于 '@':宿主 28 处 `import { Routes } from '@/routes'` 是对
      // routes.tsx 的向后兼容 re-export,会把整棵路由树 + _registry(全量
      // manifest glob)拖进 artifact;artifact 不渲染宿主路由,重定向到
      // 无副作用的常量模块(spec §9.2 已知成本收敛)。
      '@/routes': resolve(__dirname, '../../src/constants/routes'),
      '@': resolve(__dirname, '../../src'),
      '@intellect-docs': resolve(__dirname, '../../docs'),
      '@agentui/canvas-plugin': resolve(__dirname, './src'),
      '@agentui/plugin-sdk': resolve(__dirname, '../plugin-sdk/src'),
      '@agentui/plugin-sdk/host': resolve(__dirname, '../plugin-sdk/src/host.ts'),
    },
  },
  css: {
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
  build: {
    outDir: 'ui/dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2015',
    minify: 'esbuild',
    cssCodeSplit: false, // 单 CSS 产物(app.json style 声明)
    rollupOptions: {
      // 不用 build.lib:vite 7 在 lib 模式下无条件内联全部资产
      // (shouldInline 对 build.lib 直接 return true),宿主 44MB 内嵌位图
      // SVG 会被打进产物;常规 build + 显式 input 走正常资产落盘。
      // lib 语义的另一面:入口 default 导出(host 插件定义)必须保留,
      // 否则 app 模式 tree-shake 会把"未被消费的导出"整体摇掉。
      preserveEntrySignatures: 'strict',
      input: resolve(__dirname, 'src/plugin-entry.ts'),
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith('.css'))
            ? 'index.css' // 固定 CSS 文件名(app.json style 声明,不带 hash)
            : 'assets/[name]-[hash].[ext]',
        // 按 npm 包拆 chunk:共享依赖不再合并成单个巨型 chunk,
        // 可并行下载且按包缓存(canvas 内 markdown/pdf/可视化栈体量大)
        manualChunks(id: string) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          const seg = id.split('node_modules/')[1] ?? '';
          if (!seg) {
            return undefined;
          }
          const name = seg.startsWith('@')
            ? seg.split('/').slice(0, 2).join('/')
            : seg.split('/')[0];
          return name.replace('@', '').replace('/', '-');
        },
      },
    },
  },
});
