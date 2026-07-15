import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID,
  evidenceBundleManifestRelativePath,
  buildTeamArtifactHandoffEvidence,
  verifyTaskEvidence,
  runEvidenceAdd,
  runEvidenceVerify
} from '../../packages/cli/src/commands/evidence/bundle-io.ts';

const maxLines = 600;
const checkedModules = [
  'packages/cli/src/commands/evidence/bundle-io.ts',
  'packages/cli/src/commands/evidence/bundle-io/implementation.ts',
  'packages/cli/src/commands/evidence/command-runs.ts',
  'packages/cli/src/commands/evidence/evidence-store.ts',
  'packages/cli/src/commands/evidence/missing-report.ts',
  'packages/cli/src/commands/evidence/shared-utils.ts',
  'packages/cli/src/commands/evidence/validator-classification.ts'
];

for (const file of checkedModules) {
  const lineCount = readFileSync(file, 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount <= maxLines, `${file} should stay at or below ${maxLines} lines, saw ${lineCount}`);
}

const facade = readFileSync('packages/cli/src/commands/evidence/bundle-io.ts', 'utf8').trim();
assert.equal(facade, "export * from './bundle-io/implementation.ts';");

assert.equal(EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID, 'atm.evidenceBundleManifest.v1');
assert.equal(evidenceBundleManifestRelativePath('TASK-RFT-0036'), '.atm/history/evidence/TASK-RFT-0036.bundle-manifest.json');
assert.deepEqual(buildTeamArtifactHandoffEvidence({ closeAllowed: true }), {
  schemaId: 'atm.teamArtifactHandoffEvidence.v1',
  producedArtifacts: [],
  missingArtifacts: [],
  retryBudgetStatus: 'unknown',
  escalationTarget: null,
  closeAllowed: true
});
assert.equal(typeof verifyTaskEvidence, 'function');
assert.equal(typeof runEvidenceAdd, 'function');
assert.equal(typeof runEvidenceVerify, 'function');

