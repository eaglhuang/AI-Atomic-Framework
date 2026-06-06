import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepAtomRefReadability, validateAtomRefReadability } from '../packages/core/src/registry/atom-ref-readability.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string) {
  console.error(`[atom-callsite-readability:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-readable-agent-'));
try {
  const goodRepo = path.join(tempRoot, 'good-agent');
  seedReadableRepo(goodRepo, [
    [
      'src/new-atomized-feature.ts',
      [
        "import { runAtm, runAtmMap } from '@ai-atomic-framework/core';",
        '',
        'export function execute(input) {',
        makeCallsite('  const normalized = ', 'runAtm', 'normalizeOrderTotalsAtom', 'input'),
        makeCallsite('  return ', 'runAtmMap', 'invoiceReadinessMap', 'normalized'),
        '}',
        ''
      ].join('\n')
    ],
    [
      'src/local-helper.ts',
      [
        'function runAtm(cwd, args) {',
        '  return { cwd, args };',
        '}',
        '',
        "runAtm(process.cwd(), ['--version']);",
        ''
      ].join('\n')
    ]
  ]);
  const good = validateAtomRefReadability(goodRepo);
  check(good.ok === true, 'semantic readable refs must pass validation');
  check(good.callsiteCount === 2, 'semantic runAtm and runAtmMap callsites must be scanned');
  check(good.violationCount === 0, 'semantic readable refs must not produce violations');

  const rawIdRepo = path.join(tempRoot, 'raw-id-agent');
  seedReadableRepo(rawIdRepo, [
    [
      'src/new-atomized-feature.ts',
      [
        "import { runAtm } from '@ai-atomic-framework/core';",
        '',
        'export function execute(input) {',
        makeCallsite('  return ', 'runAtm', "'ATM-FIXTURE-0001'", 'input'),
        '}',
        ''
      ].join('\n')
    ]
  ]);
  const rawId = validateAtomRefReadability(rawIdRepo);
  check(rawId.ok === false, 'raw ATM ID callsites must fail validation');
  check(rawId.violations.some((entry) => entry.code === 'raw-id-callsite'), 'raw ID validation must name raw-id-callsite');

  const inlineRepo = path.join(tempRoot, 'inline-object-agent');
  seedReadableRepo(inlineRepo, [
    [
      'src/new-atomized-feature.ts',
      [
        "import { runAtm } from '@ai-atomic-framework/core';",
        '',
        'export function execute(input) {',
        makeCallsite('  return ', 'runAtm', "{ atomId: 'ATM-FIXTURE-0001' }", 'input'),
        '}',
        ''
      ].join('\n')
    ]
  ]);
  const inline = validateAtomRefReadability(inlineRepo);
  check(inline.ok === false, 'inline atom/map object callsites must fail validation');
  check(inline.violations.some((entry) => entry.code === 'raw-id-callsite'), 'inline object with atomId must be treated as a raw ID violation');

  const idLikeRepo = path.join(tempRoot, 'id-like-ref-agent');
  seedReadableRepo(idLikeRepo, [
    [
      'src/new-atomized-feature.ts',
      [
        "import { runAtm } from '@ai-atomic-framework/core';",
        '',
        "const atmCore0001Atom = defineAtmAtomRef({ atomId: 'ATM-FIXTURE-0001', logicalName: 'atom.orders.normalize-totals', purpose: 'Normalize order totals.', sourcePaths: ['src/order-totals.ts'] });",
        '',
        'export function execute(input) {',
        makeCallsite('  return ', 'runAtm', 'atmCore0001Atom', 'input'),
        '}',
        ''
      ].join('\n')
    ]
  ]);
  const idLike = validateAtomRefReadability(idLikeRepo);
  check(idLike.ok === false, 'ID-shaped readable ref names must fail validation');
  check(idLike.violations.some((entry) => entry.code === 'id-like-ref-name'), 'ID-shaped ref validation must name id-like-ref-name');

  const rewriteRepo = path.join(tempRoot, 'rewrite-agent');
  seedReadableRepo(rewriteRepo, [
    [
      'src/new-atomized-feature.ts',
      [
        "import { runAtm } from '@ai-atomic-framework/core';",
        '',
        'export function execute(input) {',
        makeCallsite('  return ', 'runAtm', "'ATM-FIXTURE-0001'", 'input'),
        '}',
        ''
      ].join('\n')
    ]
  ]);
  const sweep = sweepAtomRefReadability({
    repos: [rewriteRepo],
    apply: true,
    generatedAt: '2026-01-01T00:00:00.000Z'
  });
  const rewritten = readFileSync(path.join(rewriteRepo, 'src', 'new-atomized-feature.ts'), 'utf8');
  check(sweep.repos[0]?.rewrittenCallsites.length === 1, 'sweep --apply must rewrite one raw ID callsite');
  check(rewritten.includes('runAtm(normalizeOrderTotalsAtom, input)'), 'sweep --apply must replace raw ID with semantic ref');
  check(validateAtomRefReadability(rewriteRepo).ok === true, 'rewritten repo must pass strict validation after sweep');

  const current = validateAtomRefReadability(root);
  check(current.ok === true, 'current framework repo must pass strict atom-callsite readability validation');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[atom-callsite-readability:${mode}] ok (semantic agent pass, bad agents blocked, sweep rewrite verified)`);
}

function seedReadableRepo(repoPath: string, sourceFiles: readonly (readonly [string, string])[]) {
  mkdirSync(repoPath, { recursive: true });
  writeJson(path.join(repoPath, 'atomic-registry.json'), {
    schemaId: 'atm.registry',
    specVersion: '0.1.0',
    registryId: 'registry.agent-readable-fixture',
    generatedAt: '2026-01-01T00:00:00.000Z',
    entries: [
      {
        atomId: 'ATM-FIXTURE-0001',
        logicalName: 'atom.orders.normalize-totals',
        purpose: 'Normalize order totals before invoice generation.',
        location: {
          specPath: 'atomic_workbench/atoms/ATM-FIXTURE-0001/atom.spec.json',
          codePaths: ['src/order-totals.ts'],
          testPaths: ['tests/order-totals.test.ts'],
          reportPath: null,
          workbenchPath: 'atomic_workbench/atoms/ATM-FIXTURE-0001'
        }
      },
      {
        mapId: 'ATM-MAP-0001',
        logicalName: 'map.invoice-readiness',
        purpose: 'Prepare normalized order totals for invoice readiness.',
        location: {
          specPath: 'atomic_workbench/maps/ATM-MAP-0001/map.spec.json',
          codePaths: [],
          testPaths: ['atomic_workbench/maps/ATM-MAP-0001/map.integration.test.ts'],
          reportPath: 'atomic_workbench/maps/ATM-MAP-0001/map.test.report.json',
          workbenchPath: 'atomic_workbench/maps/ATM-MAP-0001'
        }
      }
    ]
  });
  writeJson(path.join(repoPath, 'atomic_workbench', 'readable-ref-overrides.json'), {
    'ATM-FIXTURE-0001': 'normalizeOrderTotalsAtom',
    'ATM-MAP-0001': 'invoiceReadinessMap'
  });
  writeJson(path.join(repoPath, 'atomic_workbench', 'maps', 'ATM-MAP-0001', 'map.spec.json'), {
    schemaId: 'atm.atomicMap',
    specVersion: '0.1.0',
    mapId: 'ATM-MAP-0001',
    mapVersion: '0.1.0',
    members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }],
    edges: [],
    entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: { requiredChecks: 1 },
    mapHash: 'sha256:fixture'
  });
  for (const [relativePath, content] of sourceFiles) {
    writeText(path.join(repoPath, relativePath), content);
  }
  writeText(path.join(repoPath, 'src', 'order-totals.ts'), 'export function normalizeOrderTotals(input) { return input; }\n');
  writeText(path.join(repoPath, 'tests', 'order-totals.test.ts'), 'export const ok = true;\n');
}

function writeJson(filePath: string, value: unknown) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  assert.equal(existsSync(filePath), true);
}

function makeCallsite(prefix: string, callee: string, firstArg: string, secondArg: string): string {
  return `${prefix}${callee}(${firstArg}, ${secondArg});`;
}
