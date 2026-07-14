import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCharterAuthorityBundle, renderCharterInvariantsBlock } from '../../packages/integrations-core/src/compiler/charter-block.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const firstPrinciplesTemplate = readFileSync(
  path.join(root, 'templates/root-drop/.atm/charter/atm-first-principles.template.md'),
  'utf8'
);
assert.match(firstPrinciplesTemplate, /actual monetary cost/);
assert.match(firstPrinciplesTemplate, /end-to-end time/);
assert.match(firstPrinciplesTemplate, /Raw token counts are mandatory diagnostics/);

const invariantsTemplate = JSON.parse(readFileSync(
  path.join(root, 'templates/root-drop/.atm/charter/charter-invariants.template.json'),
  'utf8'
));
assert.equal(invariantsTemplate.scheduleA.economicRatios.production.maxCostRatio, 1.1);
assert.equal(invariantsTemplate.scheduleA.economicRatios.preferred.maxCostRatio, 1.05);
assert.equal(invariantsTemplate.scheduleA.tokenDiagnostics.priceProxyAllowed, false);
assert.equal(invariantsTemplate.scheduleA.teamThresholds.production.requiresMeasuredAcceleration, true);

const tempRoot = path.join(os.tmpdir(), `atm-charter-bundle-${process.pid}`);
rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(path.join(tempRoot, '.atm/charter'), { recursive: true });

const atomicCharter = '# AtomicCharter\n\nAuthority text.\n';
const firstPrinciples = '# ATM First Principles\n\nSchedule A.\n';
writeFileSync(path.join(tempRoot, '.atm/charter/atomic-charter.md'), atomicCharter, 'utf8');
writeFileSync(path.join(tempRoot, '.atm/charter/atm-first-principles.md'), firstPrinciples, 'utf8');
writeFileSync(path.join(tempRoot, '.atm/charter/charter-invariants.json'), JSON.stringify({
  schemaId: 'atm.charterInvariants',
  schemaVersion: 'atm.invariants.v0.1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'test' },
  charterVersion: '2.0.0',
  lastAmendedAt: '2026-05-17T00:00:00.000Z',
  charterHash: sha256(atomicCharter),
  firstPrinciplesHash: sha256(firstPrinciples),
  scheduleA: invariantsTemplate.scheduleA,
  invariants: [
    {
      id: 'INV-ATM-001',
      title: 'No second registry',
      rule: 'Do not create a second registry.',
      enforcement: 'gate',
      breakingChange: true
    }
  ]
}, null, 2), 'utf8');

const bundle = loadCharterAuthorityBundle(tempRoot);
assert.equal(bundle.ok, true);
assert.equal(bundle.invariantCount, 1);
assert.equal(bundle.charterVersion, '2.0.0');
assert.equal((bundle.scheduleA as any).tokenDiagnostics.priceProxyAllowed, false);

const rendered = renderCharterInvariantsBlock(tempRoot);
assert.equal(rendered.fallbackReason, null);
assert.match(rendered.text, /INV-ATM-001/);

writeFileSync(path.join(tempRoot, '.atm/charter/atomic-charter.md'), `${atomicCharter}\nmodified\n`, 'utf8');
const mismatched = loadCharterAuthorityBundle(tempRoot);
assert.equal(mismatched.ok, false);
assert(mismatched.errors.some((error) => error.includes('hash mismatch')));

rmSync(tempRoot, { recursive: true, force: true });

console.log('[charter-bundle:test] ok');

function sha256(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
