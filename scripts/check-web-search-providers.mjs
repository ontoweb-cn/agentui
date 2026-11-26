#!/usr/bin/env node
/**
 * T4.2 / S5: web-search provider allowlist drift guard.
 *
 * Compares the three hand-maintained lists:
 * - intellect-gateway `WEB_SEARCH_PROVIDERS`
 * - bff `WEB_SEARCH_PROVIDERS`
 * - frontend `WebSearchProvider` enum
 *
 * Exit 0 only when all three sets are identical.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function extract(text, start, end, regex) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) return null;
  return [...text.slice(from, to).matchAll(regex)].map((match) => match[1]);
}

const gatewayPath = resolve(
  root,
  '../intellect-team/intellect-gateway/src/web_search_providers.rs',
);
if (!existsSync(gatewayPath)) {
  console.warn('skip: intellect-team gateway checkout not present');
  process.exit(0);
}
const gateway = extract(
  readFileSync(gatewayPath, 'utf8'),
  'const WEB_SEARCH_PROVIDERS: &[&str] = &[',
  '];',
  /"([a-z0-9]+)"/g,
);
const bff = extract(
  readFileSync(resolve(root, 'bff/src/utils/web-search-validation.ts'), 'utf8'),
  'const WEB_SEARCH_PROVIDERS = new Set<string>([',
  ']);',
  /'([a-z0-9]+)'/g,
);
const frontend = extract(
  readFileSync(resolve(root, 'src/constants/chat.ts'), 'utf8'),
  'export enum WebSearchProvider {',
  '}',
  /=\s*'([a-z0-9]+)'/g,
);

const sources = { gateway, bff, frontend };
const missingSource = Object.entries(sources).find(([, list]) => !list?.length);
if (missingSource) {
  console.error(`Unable to parse provider list: ${missingSource[0]}`);
  process.exit(1);
}

const normalized = Object.fromEntries(
  Object.entries(sources).map(([name, list]) => [name, [...new Set(list)].sort()]),
);
const expected = normalized.gateway.join(',');
let failed = false;
for (const [name, list] of Object.entries(normalized)) {
  if (list.join(',') !== expected) {
    failed = true;
    console.error(`Provider drift: ${name} differs from gateway`);
    console.error(`  gateway: ${expected}`);
    console.error(`  ${name}: ${list.join(',')}`);
  }
}

if (failed) process.exit(1);
console.log(`Provider lists aligned: ${normalized.gateway.length} providers`);
