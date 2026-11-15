import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upgradeCharter } from '../../packages/plugin-governance-local/src/index.ts';
import { loadCharterAuthorityBundle, renderCharterInvariantsBlock } from '../../packages/integrations-core/src/compiler/charter-block.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const template = JSON.parse(readFileSync(path.join(root, 'templates/root-drop/.atm/charter/charter-invariants.template.json'), 'utf8'));
const tempRoots: string[] = [];

// An adopter installed at an old charter: first three framework invariants,
// one adopter-owned invariant, an adopter field, no first-principles file.
function oldAdopter(overrides: Record<string, unknown> = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-charter-upgrade-'));
  tempRoots.push(cwd);
  mkdirSync(path.join(cwd, '.atm', 'charter'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm/charter/atomic-charter.md'), '# AtomicCharter - Host\n', 'utf8');
  writeFileSync(path.join(cwd, '.atm/charter/charter-invariants.json'), `${JSON.stringify({
    schemaId: 'atm.charterInvariants',
    charterVersion: '2.0.0',
    projectName: 'HostProject',
    hostWaivers: [{ id: 'WAIVER-1' }],
    invariants: [
      ...template.invariants.slice(0, 3),
      { id: 'INV-HOST-001', title: 'Host rule', rule: 'Host-specific rule.', enforcement: 'doctor', breakingChange: false }
    ],
    ...overrides
  }, null, 2)}\n`, 'utf8');
  return cwd;
}

const snapshot = (cwd: string) => readdirSync(path.join(cwd, '.atm/charter')).map((file) => `${file}:${readFileSync(path.join(cwd, '.atm/charter', file), 'utf8')}`).join('|');

try {
  // Dry-run reports the delta and writes nothing.
  const dryCwd = oldAdopter();
  const before = snapshot(dryCwd);
  const dry = upgradeCharter({ cwd: dryCwd, write: false, frameworkVersion: '0.1.30' });
  assert.equal(dry.status, 'outdated');
  assert.equal(dry.bundledVersion, template.charterVersion);
  assert.deepEqual(dry.addedInvariants, template.invariants.slice(3).map((entry: { id: string }) => entry.id));
  assert.deepEqual(dry.preservedAdopterInvariants, ['INV-HOST-001']);
  assert.equal(dry.scheduleAAdded, true);
  assert.ok(dry.changedFiles.includes('.atm/charter/atm-first-principles.md'));
  assert.equal(snapshot(dryCwd), before, 'dry-run must not change charter files');
  assert.equal(existsSync(path.join(dryCwd, '.atm/history')), false, 'dry-run must not write a receipt');

  // Write upgrades, keeps adopter data, stages new invariants, and is idempotent.
  const cwd = oldAdopter();
  const upgraded = upgradeCharter({ cwd, write: true, frameworkVersion: '0.1.30', now: new Date('2026-11-16T00:00:00Z') });
  assert.equal(upgraded.written, true);
  const after = JSON.parse(readFileSync(path.join(cwd, '.atm/charter/charter-invariants.json'), 'utf8'));
  assert.equal(after.charterVersion, template.charterVersion);
  assert.equal(after.projectName, 'HostProject');
  assert.deepEqual(after.hostWaivers, [{ id: 'WAIVER-1' }], 'adopter fields must be preserved');
  assert.ok(after.invariants.some((entry: { id: string }) => entry.id === 'INV-HOST-001'), 'adopter invariants must be preserved');
  const staged = after.invariants.filter((entry: { stagedEnforcement?: unknown }) => entry.stagedEnforcement);
  assert.deepEqual(staged.map((entry: { id: string }) => entry.id), dry.addedInvariants, 'only newly added invariants start advisory');
  assert.equal(staged[0].stagedEnforcement.advisoryUntilFrameworkVersion, '0.1.31');
  assert.equal(loadCharterAuthorityBundle(cwd).ok, true, 'upgraded charter must pass the authority bundle check');
  assert.match(renderCharterInvariantsBlock(cwd).text, /advisory until ATM 0\.1\.31, then `/);
  const receipt = JSON.parse(readFileSync(path.join(cwd, upgraded.receiptPath as string), 'utf8'));
  assert.equal(receipt.fromVersion, '2.0.0');
  assert.match(receipt.previousFiles['.atm/charter/charter-invariants.json'].content, /INV-HOST-001/, 'receipt keeps the previous files for rollback');
  assert.equal(upgradeCharter({ cwd, write: false }).status, 'current', 'a second run must report current');

  // --enforce-now records no advisory window.
  const enforcedCwd = oldAdopter();
  upgradeCharter({ cwd: enforcedCwd, write: true, frameworkVersion: '0.1.30', enforceNow: true });
  const enforced = JSON.parse(readFileSync(path.join(enforcedCwd, '.atm/charter/charter-invariants.json'), 'utf8'));
  assert.equal(enforced.invariants.some((entry: { stagedEnforcement?: unknown }) => entry.stagedEnforcement), false);

  // Conflicts change nothing: a charter newer than the bundle, or unparseable JSON.
  const newerCwd = oldAdopter({ charterVersion: '99.0.0' });
  const newerBefore = snapshot(newerCwd);
  const newer = upgradeCharter({ cwd: newerCwd, write: true });
  assert.equal(newer.status, 'conflict');
  assert.equal(snapshot(newerCwd), newerBefore);
  const brokenCwd = oldAdopter();
  writeFileSync(path.join(brokenCwd, '.atm/charter/charter-invariants.json'), '{ not json', 'utf8');
  assert.equal(upgradeCharter({ cwd: brokenCwd, write: true }).status, 'conflict');
  assert.equal(readFileSync(path.join(brokenCwd, '.atm/charter/charter-invariants.json'), 'utf8'), '{ not json');

  // A repository without a charter gets a fresh install.
  const emptyCwd = mkdtempSync(path.join(os.tmpdir(), 'atm-charter-upgrade-'));
  tempRoots.push(emptyCwd);
  const installed = upgradeCharter({ cwd: emptyCwd, write: true });
  assert.equal(installed.status, 'missing');
  assert.equal(loadCharterAuthorityBundle(emptyCwd).ok, true);

  console.log('[charter-upgrade.test] ok');
} finally {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
}
