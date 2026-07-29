// P1-B1.1 T039 能力门控 + P1-B1.2 spec/003 场景 9(Playwright)
// 浏览器层拦截 /auth/me + tenantInfo 注入 tenant 身份(本环境无真实企业版 session),
// capabilities 请求走真实 BFF(localhost:9390),验证:
//   T039.1/3 canvas=false → /agent/:id 403 Forbidden
//   T039.2 canvas=false → nav 菜单按 capability 过滤
//   T039.4 canvas=true 恢复 → 画布路由可访问
//   场景 9  启动发起 capabilities 请求;tenant 变化 → 重新查询
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:9391';
const SHOT_DIR = '/tmp/p1b11';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const step = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? ' — ' + note : ''}`);
};
const observe = (note) => console.log(`🔍 ${note}`);

const browser = await chromium.launch({ headless: true });

// tenantId: 指定则拦截 models 端点模拟租户;为 null 时走真实 BFF(验证短路豁免)
async function makePage(tenantId) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('Authorization', 'Bearer smoke-admin-token');
    localStorage.setItem(
      'userInfo',
      JSON.stringify({ name: 'Smoke', email: 'smoke@test.com', avatar: null }),
    );
    localStorage.setItem('lng', 'en');
  });
  const page = await context.newPage();

  const capRequests = [];
  // 记录真实发出的 capabilities 请求(header + 响应)
  page.on('request', (req) => {
    if (req.url().includes('/api/bff/capabilities')) {
      capRequests.push({ backendId: req.headers()['x-backend-id'], url: req.url() });
    }
  });
  const capResponses = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/bff/capabilities')) {
      const body = await res.json().catch(() => null);
      capResponses.push(body?.data);
    }
  });

  // 注入企业版 session 身份(本环境无真实 intellect-team,无法获取 imt_token cookie)
  await page.route('**/api/bff/auth/me**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'success',
        data: { id: 'user-1', nickname: 'Smoke', email: 'smoke@test.com', language: 'en' },
      }),
    }),
  );
  if (tenantId !== null) {
    await page.route('**/api/bff/proxy/v1/users/me/models**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            tenant_id: tenantId,
            name: 'Smoke Tenant',
            role: 'owner',
            llm_id: 'intellect-agent',
            embd_id: '',
            asr_id: '',
            img2txt_id: '',
            tts_id: '',
            rerank_id: '',
          },
        }),
      }),
    );
  }
  return { context, page, capRequests, capResponses };
}

async function waitCapabilities(page, capResponses, timeout = 15000) {
  await page
    .waitForFunction(() => performance.getEntriesByType('resource')
      .some((e) => e.name.includes('/api/bff/capabilities')), { timeout })
    .catch(() => {});
  await page.waitForResponse((r) => r.url().includes('/api/bff/capabilities'), { timeout })
    .catch(() => {});
  await page.waitForTimeout(800);
  return capResponses.at(-1);
}

// ============ 阶段 1:默认 tenant(走真实 BFF models 端点 → tenant_id='0',canvas=true)============
{
  const { context, page, capRequests, capResponses } = await makePage(null);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const caps = await waitCapabilities(page, capResponses);

  step(
    '场景9.2 启动发起 GET /api/bff/capabilities,X-Backend-Id=0',
    capRequests.length > 0 && capRequests[0].backendId === '0',
    `requests=${capRequests.length}`,
  );
  step(
    '场景9.3 tenant=0 返回 canvas=true(方案 A 合并)',
    caps?.capabilities?.canvas === true,
    `canvas=${caps?.capabilities?.canvas}`,
  );

  await page.screenshot({ path: `${SHOT_DIR}/01-home-canvas-true.png`, fullPage: true });
  const navText = await page.locator('nav').first().textContent().catch(() => '');
  observe(`canvas=true 时 nav 内容: ${navText?.slice(0, 200)}`);

  // T039.4:canvas=true 时 /agent/:id 可访问(非 403)
  await page.goto(`${BASE}/agent/smoke-canvas-id`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const url1 = page.url();
  const body1 = await page.textContent('body');
  const is403 = body1.includes('403') && /capabilityDisabled|disabled/i.test(body1);
  step('T039.4 canvas=true → /agent/:id 可访问(非 403)', !is403 && url1.includes('/agent/'),
    `url=${url1}`);
  await page.screenshot({ path: `${SHOT_DIR}/02-editor-canvas-true.png`, fullPage: true });
  await context.close();
}

// ============ 阶段 2:tenant 'backend-enterprise'(canvas=false)============
{
  const { context, page, capRequests, capResponses } = await makePage('backend-enterprise');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const caps = await waitCapabilities(page, capResponses);

  step(
    '场景9.4 tenant 切换 → 重新查询,X-Backend-Id=backend-enterprise',
    capRequests.length > 0 && capRequests[0].backendId === 'backend-enterprise',
    `requests=${capRequests.length}, backendId=${capRequests[0]?.backendId}`,
  );
  step(
    'T039.1 tenant=backend-enterprise 返回 canvas=false',
    caps?.capabilities?.canvas === false,
    `canvas=${caps?.capabilities?.canvas}`,
  );

  // T039.2:nav 过滤 — 检查带 capability 的 nav 项(datasets=knowledgeBase, memories=memory)
  await page.waitForTimeout(1000);
  const navHtml = await page.locator('nav').first().innerHTML().catch(() => '');
  const navText = await page.locator('nav').first().textContent().catch(() => '');
  observe(`canvas=false 时 nav 内容: ${navText?.slice(0, 200)}`);
  observe(`nav 含 datasets(knowledgeBase=${caps?.capabilities?.knowledgeBase}): ${navHtml.includes('dataset')}`);
  observe(`nav 含 memories(memory=${caps?.capabilities?.memory}): ${navHtml.includes('memor')}`);
  observe(`nav 含 agents/flow(无 capability 声明): ${navHtml.includes('agent')}`);
  await page.screenshot({ path: `${SHOT_DIR}/03-home-canvas-false.png`, fullPage: true });

  // T039.3:canvas=false 时直访 /agent/:id → 403 Forbidden
  await page.goto(`${BASE}/agent/smoke-canvas-id`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const body2 = await page.textContent('body');
  const has403 = body2.includes('403');
  step('T039.3 canvas=false → /agent/:id 渲染 403 Forbidden', has403);
  await page.screenshot({ path: `${SHOT_DIR}/04-editor-403.png`, fullPage: true });
  await context.close();
}

console.log('\n=== 汇总 ===');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
