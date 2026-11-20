#!/usr/bin/env node
/**
 * check-color-tokens — color token ratchet guard.
 *
 * Project convention (mirrors upstream RAGFlow web/AGENTS.md "Color Tokens"):
 * component code must use the semantic color tokens defined in tailwind.css
 * (the --colors-* and design-color variables mapped in tailwind.config.js),
 * never raw hex/rgb()/hsl() literals or Tailwind's default palette classes.
 *
 * The codebase still contains a fixed number of legacy violations. This
 * script is a RATCHET: it fails when new violations appear (a file gains
 * occurrences, or a previously-clean file gains any). Existing counts are
 * snapshotted in scripts/color-token-baseline.json; counts may only go
 * down. Regenerate the snapshot with:
 *
 *   node scripts/check-color-tokens.mjs --update
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE_FILE = path.join(__dirname, 'color-token-baseline.json');

// Whitelisted paths (relative to repo root, posix separators).
const WHITELIST = [
  'src/components/ui/',
  'src/stories/',
];

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);

// Raw color literals.
const HEX_RE = /#[0-9a-fA-F]{6}\b(?:[0-9a-fA-F]{2})?/g;
const FUNC_RE = /\b(?:rgba?|hsla?)\s*\(/g;
// Tailwind default palette utility classes, e.g. text-blue-500, bg-gray-100.
const PALETTE_CLASS_RE =
  /\b(?:text|bg|border|ring|ring-offset|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|placeholder|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)(?:-\d{2,3})?\b/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry))) {
      yield full;
    }
  }
}

function isWhitelisted(relPath) {
  const posix = relPath.split(path.sep).join('/');
  return WHITELIST.some((prefix) => posix.startsWith(prefix));
}

function countViolations(content) {
  let count = 0;
  for (const re of [HEX_RE, FUNC_RE, PALETTE_CLASS_RE]) {
    const matches = content.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

function scan() {
  const counts = {};
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file);
    if (isWhitelisted(rel)) continue;
    const n = countViolations(readFileSync(file, 'utf8'));
    if (n > 0) counts[rel.split(path.sep).join('/')] = n;
  }
  return counts;
}

function total(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

const update = process.argv.includes('--update');
const counts = scan();

if (update) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ _comment: 'Per-file legacy raw-color counts. Ratchet: may only shrink. Regenerate: node scripts/check-color-tokens.mjs --update', files: counts, total: total(counts) }, null, 2) + '\n',
  );
  console.log(`color-token baseline updated: ${total(counts)} occurrences in ${Object.keys(counts).length} files`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
} catch {
  console.error('color-token baseline missing. Run: node scripts/check-color-tokens.mjs --update');
  process.exit(1);
}

const failures = [];
for (const [file, n] of Object.entries(counts)) {
  const allowed = baseline.files[file];
  if (allowed === undefined) {
    failures.push(`${file}: ${n} raw-color occurrence(s) in a previously-clean file`);
  } else if (n > allowed) {
    failures.push(`${file}: ${n} > baseline ${allowed}`);
  }
}
for (const file of Object.keys(baseline.files)) {
  if (!(file in counts)) {
    // File cleaned up or removed — prune on next --update.
    console.log(`improved: ${file} is now clean (baseline will shrink on next --update)`);
  }
}

if (failures.length > 0) {
  console.error(`\nRaw color literals detected (use semantic tokens: colors-* / design colors in tailwind.css):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\nFix with token utilities (text-colors-*, bg-colors-*, border-colors-*, bg-bg-*, text-text-*),`);
  console.error(`or, for a deliberate exception, add the file to WHITELIST in scripts/check-color-tokens.mjs.`);
  process.exit(1);
}

console.log(`color tokens ok: no new raw-color violations (baseline ${baseline.total})`);
