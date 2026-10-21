#!/usr/bin/env node
/**
 * Generates bin/live-write-journal.generated.mjs from the core module
 * packages/core/src/live-write/live-write-journal.ts (#364).
 *
 * The kit wrapper (atm-write.mjs) must read journal records exactly like the
 * CLI. It cannot load TypeScript at run time, so it imports this generated,
 * type-stripped copy instead of keeping its own parser.
 *
 *   node bin/generate-live-write-journal.mjs          rewrite the generated copy
 *   node bin/generate-live-write-journal.mjs --check  exit 1 when the copy is stale
 *
 * test/test-live-write-journal-parity.mjs (preflight check live-write-journal-parity)
 * runs --check and compares behaviour of both modules on a fixed corpus.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..');
const SOURCE_REL = 'packages/core/src/live-write/live-write-journal.ts';
const TARGET = path.join(HERE, 'live-write-journal.generated.mjs');

export function generateLiveWriteJournalModule(sourceText) {
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
    `// Source: ${SOURCE_REL} (type-stripped by kit/bin/generate-live-write-journal.mjs).`,
    '// Regenerate: node research/paper-v2/prereg-v3-smoke/kit/bin/generate-live-write-journal.mjs',
    '// Guarded by kit/test/test-live-write-journal-parity.mjs (preflight check live-write-journal-parity).',
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
  const expected = generateLiveWriteJournalModule(readFileSync(sourcePath, 'utf8'));
  if (process.argv.includes('--check')) {
    const actual = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';
    if (actual !== expected) {
      process.stderr.write(`${path.basename(TARGET)} is stale; regenerate it from ${SOURCE_REL}\n`);
      process.exit(1);
    }
    process.stdout.write('live-write-journal.generated.mjs is current\n');
  } else {
    writeFileSync(TARGET, expected);
    process.stdout.write(`wrote ${path.relative(REPO, TARGET)}\n`);
  }
}
