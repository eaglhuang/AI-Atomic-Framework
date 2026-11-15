import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCharterIntegrityV2 } from '../../packages/cli/src/commands/doctor/utilities.ts';
import { loadCharterAuthorityBundle } from '../../packages/integrations-core/src/compiler/charter-block.ts';

// doctor must tell an outdated charter (warning, upgrade route) apart from a
// corrupt one (error), and its repair command must be the upgrade command.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const template = JSON.parse(readFileSync(path.join(root, 'templates/root-drop/.atm/charter/charter-invariants.template.json'), 'utf8'));
const tempRoots: string[] = [];

function adopter(invariantsText: string) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-doctor-charter-'));
  tempRoots.push(cwd);
  mkdirSync(path.join(cwd, '.atm', 'charter'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm/charter/atomic-charter.md'), '# AtomicCharter\n', 'utf8');
  writeFileSync(path.join(cwd, '.atm/charter/charter-invariants.json'), invariantsText, 'utf8');
  return cwd;
}

try {
  const outdated = checkCharterIntegrityV2(adopter(JSON.stringify({ charterVersion: '2.0.0', invariants: template.invariants.slice(0, 7) })));
  assert.equal(outdated.outdated, true);
  assert.equal(outdated.ok, true, 'an intact but older charter must not fail doctor');
  assert.equal(outdated.bundledCharterVersion, template.charterVersion);
  assert.equal(outdated.upgradeCommand, 'node atm.mjs charter upgrade --write --json');

  const corrupt = checkCharterIntegrityV2(adopter('{ not json'));
  assert.equal(corrupt.outdated, false);
  assert.equal(corrupt.ok, false, 'an unparseable charter must still fail doctor');

  assert.equal(loadCharterAuthorityBundle(adopter('{}')).repairCommand, 'node atm.mjs charter upgrade --write --json');
  console.log('[doctor-charter-diagnosis.test] ok');
} finally {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
}
