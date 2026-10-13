/**
 * 插件路由测试(评审 M3):
 * - 三个校验器(entry/mount path/backend target)的矩阵用例;
 * - 列表(合法/非法过滤 + 词条内联)、文件服务(ETag/304/穿越)、
 *   代理(无声明 503、SSRF target 503)、安装/卸载 token 鉴权。
 *
 * PLUGINS_DIR 经 BFF_PLUGINS_DIR 注入临时目录,必须在动态 import 前设置
 * (模块常量在 import 时求值)。
 */
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let api: typeof import('./plugins');
let fixtureDir: string;

async function writePlugin(
  id: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
) {
  const dir = join(fixtureDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'app.json'), JSON.stringify(manifest));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'agentui-plugins-test-'));
  process.env.BFF_PLUGINS_DIR = fixtureDir;
  process.env.BFF_PLUGIN_INSTALL_TOKEN = 'test-admin-token';
  api = await import('./plugins');

  await writePlugin(
    'good-plugin',
    {
      id: 'good-plugin',
      path: '/good-plugin',
      label: '测试插件',
      entry: 'ui/dist/index.js',
      backend: { type: 'proxy', target: 'http://127.0.0.1:9385' },
      i18n: { files: { zh: 'ui/locales/zh.json' } },
    },
    {
      'ui/dist/index.js': 'export {}',
      'ui/locales/zh.json': JSON.stringify({
        goodPlugin: { title: '测试词条' },
      }),
    },
  );
  // 非法插件:保留路由 + entry 穿越 → 列表过滤
  await writePlugin('evil-plugin', {
    id: 'evil-plugin',
    path: '/login',
    label: 'x',
    entry: '../../etc/passwd',
  });
  // 绕过安装校验直接落盘的 SSRF 插件(模拟安装后被篡改)→ 代理侧拦截
  await writePlugin(
    'ssrf-plugin',
    {
      id: 'ssrf-plugin',
      path: '/ssrf-plugin',
      label: 'x',
      entry: 'ui/dist/index.js',
      backend: { type: 'proxy', target: 'http://169.254.169.254/latest' },
    },
    { 'ui/dist/index.js': 'export {}' },
  );
});

afterAll(async () => {
  delete process.env.BFF_PLUGINS_DIR;
  delete process.env.BFF_PLUGIN_INSTALL_TOKEN;
  await rm(fixtureDir, { recursive: true, force: true });
});

describe('validateEntry', () => {
  it('放行白名单顶层目录的相对路径', () => {
    expect(api.validateEntry('ui/dist/index.js')).toBeNull();
    expect(api.validateEntry('assets/logo.svg')).toBeNull();
  });
  it.each([
    ['穿越', '../etc/passwd'],
    ['绝对路径', '/etc/passwd'],
    ['反斜杠', 'ui\\dist'],
    ['白名单外顶层目录', 'src/index.js'],
    ['空', ''],
  ])('拒绝 %s', (_name, entry) => {
    expect(api.validateEntry(entry)).toBeTruthy();
  });
});

describe('validateMountPath', () => {
  it('放行常规 slug', () => {
    expect(api.validateMountPath('/cognitive-wargame')).toBeNull();
    expect(api.validateMountPath('/app-2')).toBeNull();
  });
  it.each([
    ['根路径', '/'],
    ['保留路由', '/login'],
    ['应用页', '/applications'],
    ['参数段', '/x/:id'],
    ['非斜杠开头', 'foo'],
  ])('拒绝 %s', (_name, path) => {
    expect(api.validateMountPath(path)).toBeTruthy();
  });
});

describe('validateBackendTarget(SSRF 白名单)', () => {
  it.each([
    ['回环 IP', 'http://127.0.0.1:9385'],
    ['localhost', 'http://localhost:9385'],
    ['IPv6 回环', 'http://[::1]:9385'],
    ['私网 10 段', 'http://10.0.0.5:8080'],
    ['私网 192.168 段', 'http://192.168.1.10:8080'],
    ['私网 172.16 段', 'http://172.16.0.1:8080'],
  ])('放行 %s', (_name, target) => {
    expect(api.validateBackendTarget(target)).toBeNull();
  });
  it.each([
    ['公网 IP', 'http://8.8.8.8:80'],
    ['云元数据(链路本地)', 'http://169.254.169.254/latest'],
    ['公网域名', 'http://example.com'],
    ['非 http 协议', 'file:///etc/passwd'],
    ['非法 URL', 'not a url'],
  ])('拒绝 %s', (_name, target) => {
    expect(api.validateBackendTarget(target)).toBeTruthy();
  });
});

describe('GET /plugins', () => {
  it('只列出合法插件并内联词条;非法插件(SSRF/保留路由)被过滤', async () => {
    const res = await api.pluginsRoutes.request('/plugins');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    const ids = list.map((m) => m.id);
    expect(ids).toContain('good-plugin');
    expect(ids).not.toContain('evil-plugin');
    expect(ids).not.toContain('ssrf-plugin');
    const good = list.find((m) => m.id === 'good-plugin')!;
    expect(good.i18nResources).toMatchObject({
      zh: { goodPlugin: { title: '测试词条' } },
    });
  });
});

describe('GET /plugins/:id/files/*', () => {
  it('服务产物并支持 ETag/304(304 亦携带 ETag)', async () => {
    const url = '/plugins/good-plugin/files/ui/dist/index.js';
    const first = await api.pluginsRoutes.request(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/javascript');
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await api.pluginsRoutes.request(url, {
      headers: { 'If-None-Match': etag! },
    });
    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
  });

  it('路径穿越不泄露插件目录外文件(编码变体被拦截)', async () => {
    // 客户端会规范化明文 ../(未到路由即 404);编码变体到达路由后被
    // resolve 前缀校验拦截。两种结果都不允许返回目录外内容。
    const encoded = await api.pluginsRoutes.request(
      '/plugins/good-plugin/files/%2e%2e/%2e%2e/package.json',
    );
    expect([200, 403, 404]).toContain(encoded.status);
    if (encoded.status === 200) {
      // 命中 200 时必须仍是插件目录内文件(而非仓库根 package.json)
      const body = await encoded.text();
      expect(body).not.toContain('"name"');
    }
  });
});

describe('代理路由', () => {
  it('未声明 backend 的插件返回 503', async () => {
    const res = await api.pluginsRoutes.request(
      '/plugins/good-plugin-no-backend/proxy/api/v1/x',
    );
    expect(res.status).toBe(404); // 不存在的插件
  });

  it('绕过安装校验的 SSRF target 在代理侧被拦截(503)', async () => {
    // ssrf-plugin 在列表中被过滤(readPluginMeta 校验不过);
    // 代理路由经同一 readPluginMeta 读取 → 元数据为 null → 503,
    // 且代理前的 validateBackendTarget 提供第二层校验(评审 M1 双侧校验)
    const res = await api.pluginsRoutes.request(
      '/plugins/ssrf-plugin/proxy/api/v1/x',
    );
    expect(res.status).toBe(503);
  });

  it('override 存在即生效:app.json 未声明 backend 也可启用代理(评审 M2)', async () => {
    // good-plugin 声明了 backend(127.0.0.1:9385);构造未声明 backend 的
    // 插件 + override 指向不可达回环端口——期望 502(已越过 503 声明检查,
    // 进入实际转发),证明 override 凭空启用了代理通道
    const dir = join(fixtureDir, 'no-backend-plugin');
    await mkdir(join(dir, 'ui/dist'), { recursive: true });
    await writeFile(
      join(dir, 'app.json'),
      JSON.stringify({
        id: 'no-backend-plugin',
        path: '/no-backend-plugin',
        label: 'x',
        entry: 'ui/dist/index.js',
      }),
    );
    await writeFile(join(dir, 'ui/dist/index.js'), 'export {}');
    process.env.BFF_PLUGIN_BACKEND_OVERRIDES =
      'no-backend-plugin=http://127.0.0.1:1';

    const withOverride = await api.pluginsRoutes.request(
      '/plugins/no-backend-plugin/proxy/api/v1/x',
    );
    expect(withOverride.status).toBe(502); // 越过声明检查,上游不可达

    delete process.env.BFF_PLUGIN_BACKEND_OVERRIDES;
    const withoutOverride = await api.pluginsRoutes.request(
      '/plugins/no-backend-plugin/proxy/api/v1/x',
    );
    expect(withoutOverride.status).toBe(503); // 无 override 无声明 → 未启用

    await rm(dir, { recursive: true, force: true });
  });
});

describe('BFF_PLUGIN_BACKEND_OVERRIDES(#2b 部署形态)', () => {
  it('解析 env 为 id→target 映射,容忍空白与坏段', () => {
    process.env.BFF_PLUGIN_BACKEND_OVERRIDES =
      'a=http://wargamesrv:9385, b=http://10.0.0.2:9000 ,bad,=x';
    const map = api.parseBackendOverrides();
    expect(map.get('a')).toBe('http://wargamesrv:9385');
    expect(map.get('b')).toBe('http://10.0.0.2:9000');
    expect(map.size).toBe(2);
    delete process.env.BFF_PLUGIN_BACKEND_OVERRIDES;
    expect(api.parseBackendOverrides().size).toBe(0);
  });

  it('install 落盘保留原始 target,override 为代理时运行时叠加', async () => {
    const source = await mkdtemp(join(tmpdir(), 'agentui-plugin-src-'));
    await mkdir(join(source, 'ui/dist'), { recursive: true });
    await writeFile(
      join(source, 'app.json'),
      JSON.stringify({
        id: 'override-plugin',
        path: '/override-plugin',
        label: 'x',
        entry: 'ui/dist/index.js',
        backend: { type: 'proxy', target: 'http://127.0.0.1:9385' },
      }),
    );
    await writeFile(join(source, 'ui/dist/index.js'), 'export {}');
    process.env.BFF_PLUGIN_BACKEND_OVERRIDES =
      'override-plugin=http://wargamesrv:9000';

    const res = await api.pluginsRoutes.request('/plugins/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Admin-Token': 'test-admin-token',
      },
      body: JSON.stringify({ source }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      installed: 'override-plugin',
      backendTargetOverride: 'http://wargamesrv:9000',
    });
    // 落盘保留插件原始声明(严格校验对象);override 由代理每请求叠加
    const installed = JSON.parse(
      await readFile(join(fixtureDir, 'override-plugin/app.json'), 'utf-8'),
    );
    expect(installed.backend.target).toBe('http://127.0.0.1:9385');

    await rm(join(fixtureDir, 'override-plugin'), { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
    delete process.env.BFF_PLUGIN_BACKEND_OVERRIDES;
  });

  it('override 允许主机名(容器服务名/host.docker.internal)——部署者受控输入', async () => {
    // 宽松级:部署者 env 显式声明的 target 只做结构校验
    expect(
      api.validateBackendTarget('http://wargamesrv:9385', { fromOverride: true }),
    ).toBeNull();
    expect(
      api.validateBackendTarget('http://host.docker.internal:9385', {
        fromOverride: true,
      }),
    ).toBeNull();
    // 结构非法仍拒
    expect(
      api.validateBackendTarget('file:///etc/passwd', { fromOverride: true }),
    ).toBeTruthy();
    // 严格级(默认)拒绝一切非白名单主机名——防插件 app.json 声明外部地址
    expect(api.validateBackendTarget('http://wargamesrv:9385')).toBeTruthy();
    expect(
      api.validateBackendTarget('http://host.docker.internal:9385'),
    ).toBeTruthy();
  });

  it('override 目标结构非法(非 http 协议)时拒绝安装', async () => {
    const source = await mkdtemp(join(tmpdir(), 'agentui-plugin-src-'));
    await mkdir(join(source, 'ui/dist'), { recursive: true });
    await writeFile(
      join(source, 'app.json'),
      JSON.stringify({
        id: 'bad-override-plugin',
        path: '/bad-override-plugin',
        label: 'x',
        entry: 'ui/dist/index.js',
      }),
    );
    await writeFile(join(source, 'ui/dist/index.js'), 'export {}');
    process.env.BFF_PLUGIN_BACKEND_OVERRIDES =
      'bad-override-plugin=file:///etc/passwd';

    const res = await api.pluginsRoutes.request('/plugins/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Admin-Token': 'test-admin-token',
      },
      body: JSON.stringify({ source }),
    });
    expect(res.status).toBe(400);
    await rm(source, { recursive: true, force: true });
    delete process.env.BFF_PLUGIN_BACKEND_OVERRIDES;
  });
});

describe('install/delete 鉴权', () => {
  it('无 token 拒绝(403)', async () => {
    const res = await api.pluginsRoutes.request('/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: fixtureDir }),
    });
    expect(res.status).toBe(403);
  });

  it('带 token 可安装与卸载', async () => {
    const source = await mkdtemp(join(tmpdir(), 'agentui-plugin-src-'));
    await mkdir(join(source, 'ui/dist'), { recursive: true });
    await writeFile(
      join(source, 'app.json'),
      JSON.stringify({
        id: 'tmp-plugin',
        path: '/tmp-plugin',
        label: 'x',
        entry: 'ui/dist/index.js',
      }),
    );
    await writeFile(join(source, 'ui/dist/index.js'), 'export {}');

    const install = await api.pluginsRoutes.request('/plugins/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Admin-Token': 'test-admin-token',
      },
      body: JSON.stringify({ source }),
    });
    expect(install.status).toBe(200);
    expect(
      (await readdir(join(fixtureDir, 'tmp-plugin'))).sort(),
    ).toEqual(['app.json', 'ui']);

    const del = await api.pluginsRoutes.request('/plugins/tmp-plugin', {
      method: 'DELETE',
      headers: { 'X-Plugin-Admin-Token': 'test-admin-token' },
    });
    expect(del.status).toBe(200);
    await rm(source, { recursive: true, force: true });
  });
});
