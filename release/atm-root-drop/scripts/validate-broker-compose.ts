import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeBrokerProposals } from '../packages/core/src/broker/compose.ts';
import { compareProposalsForCompose, sortProposalsForCompose } from '../packages/core/src/broker/merge-plan.ts';
import { runBroker } from '../packages/cli/src/commands/broker.ts';
import type { PatchProposal } from '../packages/core/src/broker/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function check(condition: unknown, message: string) {
  assert.ok(condition, `[broker-compose:${mode}] ${message}`);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

async function runAtm(args: string[]) {
  const normalizedArgs = args.filter((arg) => arg !== 'broker' && arg !== '--json');
  try {
    const parsed = await runBroker([...normalizedArgs, '--cwd', root]);
    return { exitCode: 0, parsed };
  } catch (error: any) {
    return {
      exitCode: typeof error?.exitCode === 'number' ? error.exitCode : 1,
      parsed: { ok: false, evidence: error?.details ?? {} }
    };
  }
}

function baseProposal(overrides: Partial<PatchProposal> & Pick<PatchProposal, 'proposalId'>): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'compose-fixture' },
    taskId: 'TASK-CID-0019',
    actorId: '008',
    baseCommit: 'commit-base-0019',
    fileBeforeHash: 'hash-target-alpha',
    targetFile: 'src/target.ts',
    atomRefs: [{ atomId: overrides.proposalId, atomCid: `cid-${overrides.proposalId}` }],
    anchors: [{ kind: 'line', hint: 'anchor-default' }],
    intent: 'compose fixture',
    patch: '--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n',
    validators: ['npm run typecheck'],
    rollback: 'revert compose fixture',
    ...overrides
  };
}

function ensureRequiredFiles() {
  for (const relativePath of [
    'package.json',
    'scripts/validators.config.json',
    'packages/core/src/broker/compose.ts',
    'packages/core/src/broker/merge-plan.ts',
    'packages/cli/src/commands/broker.ts',
    'packages/cli/src/commands/command-specs/broker.spec.ts',
    'tests/cli-fixtures/help-snapshots/broker.json'
  ]) {
    check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
  }
}

function ensureConfigWiring() {
  const packageJson = readJson('package.json');
  check(
    packageJson.scripts?.['validate:broker-compose'] === 'node --strip-types scripts/validate-broker-compose.ts --mode validate',
    'package.json must expose validate:broker-compose'
  );

  const validatorsConfig = readJson('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry: any) => entry.name === 'validate-broker-compose');
  check(Boolean(validatorDef), 'validators.config.json must register validate-broker-compose');
  check(validatorDef?.entry === 'scripts/validate-broker-compose.ts', 'validate-broker-compose entry path mismatch');
  check(validatorDef?.slow === false, 'validate-broker-compose should be a fast validator');
  check(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-broker-compose') === true,
    'standard profile must include validate-broker-compose'
  );
}

ensureRequiredFiles();
ensureConfigWiring();

const disjointA = baseProposal({
  proposalId: 'proposal.compose.0019.a',
  anchors: [{ kind: 'line', hint: 'anchor-a' }],
  patch: '--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n'
});
const disjointB = baseProposal({
  proposalId: 'proposal.compose.0019.b',
  atomRefs: [{ atomId: 'ATM-CORE-0019-B', atomCid: 'cid-0019-b' }],
  anchors: [{ kind: 'line', hint: 'anchor-b' }],
  patch: '--- a/src/target.ts\n+++ b/src/target.ts\n@@ -3,1 +3,1 @@\n-gamma\n+delta\n'
});

const sorted = sortProposalsForCompose([disjointB, disjointA]);
check(sorted[0].proposalId === disjointA.proposalId, 'sort must order by firstAnchorKey then proposalId');
check(compareProposalsForCompose(disjointA, disjointB) < 0, 'compareProposalsForCompose must be deterministic');

const parallel = composeBrokerProposals([disjointB, disjointA]);
check(parallel.ok === true, 'disjoint same-file proposals must compose successfully');
check(parallel.mergePlan.verdict === 'parallel-safe', 'disjoint proposals must be parallel-safe');
check(parallel.mergePlan.applyMethod === 'patch-apply', 'parallel-safe merge plan must use patch-apply');
check(parallel.mergePlan.inputProposals[0] === disjointA.proposalId, 'merge plan inputProposals must follow deterministic sort');

const determinismA = composeBrokerProposals([disjointB, disjointA]);
const determinismB = composeBrokerProposals([disjointA, disjointB]);
check(
  JSON.stringify(determinismA.mergePlan) === JSON.stringify(determinismB.mergePlan),
  'compose output must be identical regardless of input order'
);

const cidConflict = composeBrokerProposals([
  disjointA,
  baseProposal({
    proposalId: 'proposal.compose.0019.cid-conflict',
    atomRefs: [{ atomId: disjointA.atomRefs[0].atomId, atomCid: 'cid-other' }]
  })
]);
check(cidConflict.ok === false, 'duplicate atomId across proposals must fail closed');
check(cidConflict.mergePlan.verdict === 'blocked-cid-conflict', 'duplicate atomId must produce blocked-cid-conflict');

const metadataMismatch = composeBrokerProposals([
  disjointA,
  baseProposal({
    proposalId: 'proposal.compose.0019.metadata',
    baseCommit: 'different-commit',
    atomRefs: [{ atomId: 'ATM-CORE-0019-META', atomCid: 'cid-meta' }],
    anchors: [{ kind: 'line', hint: 'anchor-meta' }]
  })
]);
check(metadataMismatch.mergePlan.verdict === 'needs-steward', 'baseCommit mismatch must route to needs-steward');
check(metadataMismatch.mergePlan.conflicts.some((entry) => entry.detail.includes('baseCommit')), 'metadata mismatch must be reported');

const anchorOverlap = composeBrokerProposals([
  disjointA,
  baseProposal({
    proposalId: 'proposal.compose.0019.anchor',
    atomRefs: [{ atomId: 'ATM-CORE-0019-ANCHOR', atomCid: 'cid-anchor' }],
    anchors: disjointA.anchors
  })
]);
check(anchorOverlap.mergePlan.verdict === 'needs-steward', 'duplicate anchor key must route to needs-steward');
check(anchorOverlap.mergePlan.conflicts.some((entry) => entry.detail.includes('Anchor overlap')), 'anchor overlap must be reported');

const rangeOverlap = composeBrokerProposals([
  disjointA,
  baseProposal({
    proposalId: 'proposal.compose.0019.range',
    atomRefs: [{ atomId: 'ATM-CORE-0019-RANGE', atomCid: 'cid-range' }],
    anchors: [{ kind: 'line', hint: 'anchor-range' }],
    patch: '--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1,2 +1,2 @@\n-alpha\n+beta\n'
  })
]);
check(rangeOverlap.mergePlan.verdict === 'needs-steward', 'patch hunk overlap must route to needs-steward');
check(rangeOverlap.mergePlan.conflicts.some((entry) => entry.detail.includes('Patch hunk overlap')), 'range overlap must be reported');

const composeCli = await runAtm([
  'broker',
  'compose',
  '--proposal-file',
  path.join('scripts', '__does-not-exist__')
]);
check(composeCli.exitCode !== 0, 'compose CLI must reject missing proposal file');

console.log(`[broker-compose:${mode}] ok`);
