// Babel 插件：在 Jest transform 阶段静态解析 import.meta.glob(...) 调用。
//
// 背景：Vite 的 import.meta.glob 是编译时 API，由 Vite 在构建时扫描文件系统
// 并生成对应的 import 语句。Jest 运行在 Node.js 环境，esbuild-jest 把
// import.meta 转换为空对象，导致 import.meta.glob 为 undefined，调用时报
// "import_meta.glob is not a function"。
//
// 本插件在 Babel AST 层面识别 import.meta.glob(pattern, options) 调用，
// 静态解析 glob 模式（相对于当前文件，支持 @/ 别名），匹配实际文件，
// 生成等价的对象字面量：
//
//   // 源码（eager + 默认 import）
//   const m = import.meta.glob('./*/manifest.ts', { eager: true });
//   // 转换为
//   const m = {
//     '/abs/path/to/canvas/manifest.ts': require('/abs/path/to/canvas/manifest.ts'),
//     // ...
//   };
//
//   // 源码（lazy + ?url）
//   const m = import.meta.glob('@/assets/svg/**/*.svg', { query: '?url' });
//   // 转换为
//   const m = {
//     '/abs/path/to/foo.svg': { default: '/abs/path/to/foo.svg' },
//     // ...
//   };
//
// 支持的 Vite 选项：
//   - eager: true/false（默认 false，lazy）
//   - query: '?url' / '?raw'
//   - as: 'url' / 'raw'（query 的 deprecated 别名）
//   - import: 'default' / '*'（默认 '*'，返回整个模块命名空间）
//
// 限制：
//   - 不支持动态 pattern（非常量字符串）
//   - import: 'named' 的解构语法不支持（Vite 5+ 特性，本项目未使用）
//   - 生成的 key 是绝对路径（Vite 返回相对/别名路径），本项目的消费者
//     （svg-icon.tsx 用正则剥离前缀，_registry.ts 只用 values）均不依赖
//     key 的具体格式，因此安全

const path = require('path');
const fs = require('fs');
const fg = require('fast-glob');

const JEST_CONFIG_FILES = [
  'jest.config.ts',
  'jest.config.js',
  'jest.config.cjs',
  'jest.config.mjs',
];

// 按目录缓存 rootDir 查找结果，避免每个文件都遍历目录树
const rootDirCache = new Map();

/**
 * 从源文件路径向上查找最近的 jest.config.* 文件所在目录作为 rootDir。
 * 这样无论 Jest 从哪个目录启动，都能正确解析 <rootDir> 占位符。
 */
function findRootDir(sourceFilePath) {
  let dir = path.dirname(sourceFilePath);
  while (true) {
    if (rootDirCache.has(dir)) return rootDirCache.get(dir);
    const found = JEST_CONFIG_FILES.some((f) =>
      fs.existsSync(path.join(dir, f)),
    );
    if (found) {
      rootDirCache.set(dir, dir);
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // 已到文件系统根，回退到 process.cwd()
      const fallback = process.cwd();
      rootDirCache.set(dir, fallback);
      return fallback;
    }
    dir = parent;
  }
}

/**
 * 判断 CallExpression 是否为 import.meta.glob(...) 调用。
 */
function isImportMetaGlobCall(t, node) {
  return (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    t.isMetaProperty(node.callee.object) &&
    node.callee.object.meta.name === 'import' &&
    node.callee.object.property.name === 'meta' &&
    t.isIdentifier(node.callee.property, { name: 'glob' })
  );
}

/**
 * 解析别名前缀（如 @/）到绝对路径。支持 <rootDir> 占位符。
 */
function resolveAlias(pattern, aliases, rootDir) {
  for (const [prefix, target] of Object.entries(aliases)) {
    const aliasPrefix = prefix.endsWith('/') ? prefix : prefix + '/';
    if (pattern.startsWith(aliasPrefix)) {
      const rest = pattern.slice(aliasPrefix.length);
      const resolvedTarget = target.replace(/<rootDir>/g, rootDir);
      return path.join(resolvedTarget, rest);
    }
    if (pattern === prefix) {
      return target.replace(/<rootDir>/g, rootDir);
    }
  }
  return null;
}

/**
 * 将 glob pattern 解析为绝对路径 pattern（供 fast-glob 使用）。
 */
function resolvePattern(pattern, sourceFile, aliases, rootDir) {
  // 别名 pattern（如 @/foo/*.ts）
  const aliased = resolveAlias(pattern, aliases, rootDir);
  if (aliased) return aliased;
  // 相对 pattern
  if (pattern.startsWith('./') || pattern.startsWith('../')) {
    return path.resolve(path.dirname(sourceFile), pattern);
  }
  // 绝对-from-root pattern（如 /src/foo/*.ts）
  if (pattern.startsWith('/')) {
    return path.join(rootDir, pattern.slice(1));
  }
  // 裸 pattern，按相对处理
  return path.resolve(path.dirname(sourceFile), pattern);
}

/**
 * 从第二个参数（options 对象）解析配置。
 */
function parseOptions(arg, t) {
  const opts = { eager: false, import: '*', query: null, as: null };
  if (!arg || !t.isObjectExpression(arg)) return opts;
  for (const prop of arg.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (!key) continue;
    if (key === 'eager' && t.isBooleanLiteral(prop.value)) {
      opts.eager = prop.value.value;
    } else if (key === 'import' && t.isStringLiteral(prop.value)) {
      opts.import = prop.value.value;
    } else if (key === 'query' && t.isStringLiteral(prop.value)) {
      opts.query = prop.value.value;
    } else if (key === 'as' && t.isStringLiteral(prop.value)) {
      opts.as = prop.value.value;
    }
  }
  return opts;
}

/**
 * 为单个匹配文件构造模块值的 AST 节点。
 */
function buildModuleValue(t, filePath, opts) {
  // ?url 或 as:'url' → { default: filePath }
  if (opts.query === '?url' || opts.as === 'url') {
    return t.objectExpression([
      t.objectProperty(t.identifier('default'), t.stringLiteral(filePath)),
    ]);
  }
  // ?raw 或 as:'raw' → { default: fileContent }
  if (opts.query === '?raw' || opts.as === 'raw') {
    const content = fs.readFileSync(filePath, 'utf-8');
    return t.objectExpression([
      t.objectProperty(t.identifier('default'), t.stringLiteral(content)),
    ]);
  }
  // eager: true → require(filePath)（整个模块命名空间）
  if (opts.eager) {
    const req = t.callExpression(t.identifier('require'), [
      t.stringLiteral(filePath),
    ]);
    if (opts.import === 'default') {
      return t.memberExpression(req, t.identifier('default'));
    }
    return req;
  }
  // lazy（默认）→ () => Promise.resolve(require(filePath))
  const req = t.callExpression(t.identifier('require'), [
    t.stringLiteral(filePath),
  ]);
  const val =
    opts.import === 'default'
      ? t.memberExpression(req, t.identifier('default'))
      : req;
  return t.arrowFunctionExpression(
    [],
    t.callExpression(
      t.memberExpression(t.identifier('Promise'), t.identifier('resolve')),
      [val],
    ),
  );
}

/**
 * @param {object} babelState - Babel state，含 { types: t }
 * @param {object} pluginOpts - 插件选项 { aliases, rootDir }
 *   - aliases: { '@': '<rootDir>/src', ... }
 *   - rootDir: 可选，未提供时从源文件路径自动推导
 */
module.exports = function importMetaGlobPlugin({ types: t }, pluginOpts) {
  const opts = pluginOpts || {};
  const aliases = opts.aliases || { '@': '<rootDir>/src' };

  return {
    visitor: {
      CallExpression(path, state) {
        const node = path.node;
        if (!isImportMetaGlobCall(t, node)) return;

        const sourceFile = state.filename || '';
        const rootDir = opts.rootDir || findRootDir(sourceFile);

        // 解析 pattern 参数（StringLiteral | ArrayExpression<StringLiteral>）
        const patternArg = node.arguments[0];
        const patterns = [];
        if (t.isStringLiteral(patternArg)) {
          patterns.push(patternArg.value);
        } else if (t.isArrayExpression(patternArg)) {
          for (const el of patternArg.elements) {
            if (t.isStringLiteral(el)) patterns.push(el.value);
          }
        } else {
          // 动态 pattern，无法静态转换，跳过（让 esbuild 处理，可能会失败）
          return;
        }

        const globOpts = parseOptions(node.arguments[1], t);

        // 对每个 pattern 解析并匹配文件
        const entries = [];
        for (const pattern of patterns) {
          const resolved = resolvePattern(
            pattern,
            sourceFile,
            aliases,
            rootDir,
          );
          const matches = fg.sync(resolved, { absolute: true, dot: false });
          for (const abs of matches.sort()) {
            entries.push({ key: abs, value: buildModuleValue(t, abs, globOpts) });
          }
        }

        // 构造对象字面量替换原调用
        const properties = entries.map(({ key, value }) =>
          t.objectProperty(t.stringLiteral(key), value),
        );
        path.replaceWith(t.objectExpression(properties));
      },
    },
  };
};
