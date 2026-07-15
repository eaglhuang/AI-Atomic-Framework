import assert from 'node:assert/strict';
import { createTeamContributionManifest } from '../../packages/core/src/team-runtime/contribution-manifest.ts';
import {
  composeTeamContributionManifests,
  type TeamContributionCompositionResult
} from '../../packages/cli/src/commands/team/composer.ts';
import {
  reconcileTeamContributionCompositionWithCommitBundle,
  type TaskflowGovernedCommitBundle
} from '../../packages/cli/src/commands/taskflow/commit-bundle-assembly.ts';

const baseCommit = 'abc123base';
const contextManifestDigest = `sha256:${'a'.repeat(64)}`;

function manifest(role: string, changedFiles: readonly string[]) {
  return createTeamContributionManifest({
    taskId: 'ATM-GOV-0136',
    role,
    workerId: `worker-${role}`,
    baseCommit,
    contextManifestDigest,
    overlay: { role, changedFiles },
    changedFiles
  });
}

const compatible = composeTeamContributionManifests({
  taskId: 'ATM-GOV-0136',
  baseCommit,
  declaredScope: ['packages/cli/src/commands/team'],
  contributions: [
    {
      manifest: manifest('implementer', ['packages/cli/src/commands/team/composer.ts']),
      files: [{ path: 'packages/cli/src/commands/team/composer.ts', sha256: `sha256:${'1'.repeat(64)}` }]
    },
    {
      manifest: manifest('validator', ['packages/cli/src/commands/team/composer.ts']),
      files: [{ path: 'packages/cli/src/commands/team/composer.ts', sha256: '1'.repeat(64) }]
    }
  ]
});

assert.equal(compatible.failClosed, false);
assert.equal(compatible.conflicts.length, 0);
assert.equal(compatible.finalTree.files.length, 1);
assert.equal(compatible.finalTree.files[0].contributionIds.length, 2);
assert.equal(compatible.scopeExpansion.required, false);
assert.match(compatible.finalTreeDigest, /^sha256:[a-f0-9]{64}$/);

const conflict = composeTeamContributionManifests({
  taskId: 'ATM-GOV-0136',
  baseCommit,
  declaredScope: ['packages/cli/src/commands/team'],
  contributions: [
    {
      manifest: manifest('implementer', ['packages/cli/src/commands/team/composer.ts']),
      files: [{ path: 'packages/cli/src/commands/team/composer.ts', sha256: `sha256:${'1'.repeat(64)}` }]
    },
    {
      manifest: manifest('validator', ['packages/cli/src/commands/team/composer.ts']),
      files: [{ path: 'packages/cli/src/commands/team/composer.ts', sha256: `sha256:${'2'.repeat(64)}` }]
    }
  ]
});

assert.equal(conflict.failClosed, true);
assert.deepEqual(conflict.conflicts[0].hashes, [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`]);

const scopeExpansion = composeTeamContributionManifests({
  taskId: 'ATM-GOV-0136',
  baseCommit,
  declaredScope: ['packages/cli/src/commands/team'],
  contributions: [
    {
      manifest: manifest('implementer', ['packages/core/src/team-runtime/foreign.ts']),
      files: [{ path: 'packages/core/src/team-runtime/foreign.ts', sha256: `sha256:${'3'.repeat(64)}` }]
    }
  ]
});

assert.equal(scopeExpansion.failClosed, true);
assert.equal(scopeExpansion.scopeExpansion.owner, 'composer');
assert.deepEqual(scopeExpansion.scopeExpansion.candidateFiles, ['packages/core/src/team-runtime/foreign.ts']);

const bundle = reconcileTeamContributionCompositionWithCommitBundle(fakeBundle(), scopeExpansion);
assert.equal(bundle.failClosed, true);
assert.equal(bundle.scopeAmendment.required, true);
assert.equal(bundle.scopeAmendment.candidateFiles.includes('packages/core/src/team-runtime/foreign.ts'), true);
assert.equal(bundle.targetRepo.stageFiles.includes('packages/core/src/team-runtime/foreign.ts'), true);

console.log('[team-contribution-composer] ok');

function fakeBundle(): TaskflowGovernedCommitBundle {
  return {
    schemaId: 'atm.taskflowGovernedCommitBundle.v1',
    taskId: 'ATM-GOV-0136',
    actorId: 'codex-gpt-5-5-captain',
    targetRepo: {
      repoRoot: process.cwd(),
      stageFiles: [],
      commitMessage: 'target',
      commitCommand: '',
      commitSha: null,
      status: 'preview'
    },
    planningRepo: {
      repoRoot: process.cwd(),
      stageFiles: [],
      commitMessage: 'planning',
      commitCommand: '',
      commitSha: null,
      status: 'preview'
    },
    commitMode: 'dry-run',
    failClosed: false,
    recoveryCommand: null,
    targetDeliveryFiles: [],
    targetGovernanceFiles: [],
    planningFiles: [],
    excludedDirtyFiles: [],
    excludedReasons: {},
    scopeAmendment: {
      required: false,
      candidateFiles: [],
      reason: null,
      remediationCommand: null,
      humanReviewRequired: false,
      notes: []
    },
    sealAndCommitReceipt: {
      schemaId: 'atm.taskflowSealAndCommitReceipt.v1',
      taskId: 'ATM-GOV-0136',
      actorId: 'codex-gpt-5-5-captain',
      createdAt: '2026-07-14T00:00:00.000Z',
      targetHeadBeforeCommit: baseCommit,
      planningHeadBeforeCommit: baseCommit,
      historicalDeliveryRefs: [],
      historicalBatchRef: null,
      manifestPath: '.atm/history/evidence/ATM-GOV-0136.seal-and-commit.json',
      targetPayloadDigest: `sha256:${'4'.repeat(64)}`,
      targetEvidenceDigest: `sha256:${'5'.repeat(64)}`,
      planningPayloadDigest: `sha256:${'6'.repeat(64)}`,
      planningEvidenceDigest: `sha256:${'7'.repeat(64)}`,
      sealDigest: `sha256:${'8'.repeat(64)}`
    }
  };
}
