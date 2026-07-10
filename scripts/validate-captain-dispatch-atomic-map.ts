#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/captain-dispatch-mailbox/cli.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message: string): never {
  console.error(`[validate-captain-dispatch-atomic-map] ${message}`);
  process.exit(1);
}

function lines(rel: string): number {
  return readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/).length;
}

const required = [
  'scripts/captain-dispatch-mailbox/layout.ts',
  'scripts/captain-dispatch-mailbox/ledger.ts',
  'scripts/captain-dispatch-mailbox/cli.ts',
  'scripts/captain-dispatch-mailbox/stop-loss.ts',
  'scripts/captain-dispatch-mailbox/frontmatter.ts',
  'scripts/captain-dispatch-mailbox/lanes/inbox.ts',
  'scripts/captain-dispatch-mailbox/lanes/outbox.ts',
  'scripts/captain-dispatch-mailbox/lanes/reports.ts',
  'scripts/captain-dispatch-mailbox/__tests__/layout.spec.ts',
  'scripts/captain-dispatch-mailbox/__tests__/ledger.spec.ts',
  'scripts/captain-dispatch-mailbox/__tests__/inbox.spec.ts',
  'scripts/captain-dispatch-mailbox/__tests__/outbox.spec.ts',
  'scripts/captain-dispatch-mailbox/__tests__/reports.spec.ts',
  'scripts/captain-dispatch-mailbox/__tests__/stop-loss.spec.ts',
  'docs/reports/captain-dispatch-mailbox-atomic-map.md'
];

for (const rel of required) {
  if (!existsSync(path.join(root, rel))) fail(`missing ${rel}`);
}

const facadeLines = lines('scripts/captain-dispatch-mailbox.ts');
if (facadeLines >= 400) fail(`facade must be under 400 lines, found ${facadeLines}`);

const parsed = parseArgs([
  '--root', '.atm-temp/x',
  '--agents', '001,002',
  '--captain-model', 'codex',
  '--worker-model', 'gpt',
  '--role', 'all',
  '--stale-minutes', '20',
  '--max-dispatch', '2',
  '--seed-demo',
  '--json'
]);
if (parsed.help) fail('unexpected help');
if (!parsed.seedDemo) fail('--seed-demo must set seedDemo');
if (!parsed.json) fail('--json must set json');
if (parsed.agents.length < 1) fail('--agents must parse');

console.log(JSON.stringify({ ok: true, facadeLines, modules: 8 }, null, 2));
