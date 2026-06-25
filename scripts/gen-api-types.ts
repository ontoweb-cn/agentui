import openapiTS, { ast } from 'openapi-typescript';
import { writeFileSync, mkdirSync } from 'node:fs';

const SPEC_URL =
  process.env.OPENAPI_SPEC_URL || 'http://localhost:9380/api/v1/openapi.json';
const OUTPUT_PATH = './src/interfaces/generated/api-types.ts';

async function main() {
  console.log(`[gen-api-types] Fetching OpenAPI spec from ${SPEC_URL}...`);

  try {
    const astNodes = await openapiTS(new URL(SPEC_URL));
    const code = [
      '// AUTO-GENERATED. DO NOT EDIT.',
      '// Run: npm run gen:api-types',
      '// Source: ' + SPEC_URL,
      '',
      ast.stringify(astNodes),
      '',
    ].join('\n');

    mkdirSync('./src/interfaces/generated', { recursive: true });
    writeFileSync(OUTPUT_PATH, code);
    console.log(`[gen-api-types] ✓ Types generated to ${OUTPUT_PATH}`);
  } catch (err) {
    const error = err as Error;
    console.error(`[gen-api-types] ✗ Failed: ${error.message}`);
    console.error('');
    console.error('Make sure the Intellect backend is running and exposes');
    console.error('  GET /api/v1/openapi.json');
    console.error('Or set OPENAPI_SPEC_URL to a reachable spec URL.');
    process.exit(1);
  }
}

main();
