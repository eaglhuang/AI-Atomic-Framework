#!/usr/bin/env node
/**
 * Generates bin/unified-patch.generated.mjs from the core module
 * packages/core/src/broker/unified-patch.ts (#359, #361).
 *
 * The kit wrapper (atm-write.mjs) must parse and locate hunks exactly like the
 * CLI. It cannot load TypeScript at run time, so it imports this generated,
 * type-stripped copy instead of keeping its own parser.
 *
 *   node bin/generate-unified-patch.mjs          rewrite the generated copy
 *   node bin/generate-unified-patch.mjs --check  exit 1 when the copy is stale
 *
 * test/test-hunk-locator-parity.sh (preflight check hunk-locator-parity)
 * runs --check and compares behaviour of both modules on a fixed corpus.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..');
const SOURCE_REL = 'packages/core/src/broker/unified-patch.ts';
const TARGET = path.join(HERE, 'unified-patch.generated.mjs');

export function generateUnifiedPatchModule(sourceText) {
  process.removeAllListeners('warning');
  const stripped = stripTypeScriptTypes(sourceText, { mode: 'strip' });
  const body = stripped
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  return [
    '// GENERATED FILE. DO NOT EDIT.',
    `// Source: ${SOURCE_REL} (type-stripped by kit/bin/generate-unified-patch.mjs).`,
    '// Regenerate: node research/paper-v2/prereg-v3-kits/cli-0.1.22-v14-367/bin/generate-unified-patch.mjs',
    '// Guarded by kit/test/test-hunk-locator-parity.sh (preflight check hunk-locator-parity).',
    '',
    body,
    ''
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourcePath = path.join(REPO, SOURCE_REL);
  if (!existsSync(sourcePath)) {
    process.stderr.write(`missing core source ${sourcePath}\n`);
    process.exit(2);
  }
  const expected = generateUnifiedPatchModule(readFileSync(sourcePath, 'utf8'));
  if (process.argv.includes('--check')) {
    const actual = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';
    if (actual !== expected) {
      process.stderr.write(`${path.basename(TARGET)} is stale; regenerate it from ${SOURCE_REL}\n`);
      process.exit(1);
    }
    process.stdout.write('unified-patch.generated.mjs is current\n');
  } else {
    writeFileSync(TARGET, expected);
    process.stdout.write(`wrote ${path.relative(REPO, TARGET)}\n`);
  }
}
