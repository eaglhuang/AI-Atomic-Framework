import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { composeBrokerProposals } from '../packages/core/src/broker/compose.ts';
import { applyStewardPlan, planStewardApply } from '../packages/core/src/broker/steward.ts';
import { runBroker } from '../packages/cli/src/commands/broker.ts';
import type { PatchProposal } from '../packages/core/src/broker/types.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function check(condition: unknown, message: string) {
  assert.ok(condition, `[broker-steward:${mode}] ${message}`);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(readJson('schemas/broker/operation-run-record.schema.json'));
const validateStewardApplyEvidence = ajv.compile(readJson('schemas/broker/steward-apply-evidence.schema.json'));

function formatAjvErrors(errors: any) {
  return (errors || [])
    .map((error: any) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function assertStewardApplyEvidence(value: unknown, label: string) {
  check(validateStewardApplyEvidence(value), `${label} must match steward apply evidence schema: ${formatAjvErrors(validateStewardApplyEvidence.errors)}`);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runAtm(args: string[], cwd = root) {
  const normalizedArgs = args.filter((arg) => arg !== 'broker' && arg !== '--json');
  try {
    const parsed = await runBroker([...normalizedArgs, '--cwd', cwd]);
    return { exitCode: 0, parsed };
  } catch (error: any) {
    return {
      exitCode: typeof error?.exitCode === 'number' ? error.exitCode : 1,
      parsed: { ok: false, evidence: error?.details ?? {} }
    };
  }
}

function commitText(cwd: string, message: string) {
  const add = spawnSync('git', ['-C', cwd, 'add', '-A'], { encoding: 'utf8' });
  check(add.status === 0, `git add failed: ${add.stderr || add.stdout}`);
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=ATM', '-c', 'user.email=atm@example.com', 'commit', '-m', message], {
    encoding: 'utf8'
  });
  check(result.status === 0, `git commit failed: ${result.stderr || result.stdout}`);
  const sha = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  check(sha.status === 0, `git rev-parse HEAD failed: ${sha.stderr || sha.stdout}`);
  return String(sha.stdout ?? '').trim();
}

function hashFile(filePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function makeProposal(baseCommit: string, fileBeforeHash: string, proposalId = 'proposal.steward.0020.valid'): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'steward-fixture' },
    proposalId,
    taskId: 'TASK-CID-0020',
    actorId: '008',
    baseCommit,
    fileBeforeHash,
    targetFile: 'src/target.ts',
    atomRefs: [{ atomId: 'ATM-CORE-0020', atomCid: 'cid-0020' }],
    anchors: [{ kind: 'line', hint: 'anchor-steward' }],
    intent: 'steward fixture',
    patch: '--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1,1 +1,1 @@\n-alpha\n+beta\n',
    validators: ['npm run typecheck'],
    rollback: 'revert steward fixture'
  };
}

function ensureRequiredFiles() {
  for (const relativePath of [
    'package.json',
    'scripts/validators.config.json',
    'packages/core/src/broker/steward.ts',
    'packages/core/src/broker/apply-evidence.ts',
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
    packageJson.scripts?.['validate:broker-steward'] === 'node --strip-types scripts/validate-broker-steward.ts --mode validate',
    'package.json must expose validate:broker-steward'
  );

  const validatorsConfig = readJson('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry: any) => entry.name === 'validate-broker-steward');
  check(Boolean(validatorDef), 'validators.config.json must register validate-broker-steward');
  check(validatorDef?.entry === 'scripts/validate-broker-steward.ts', 'validate-broker-steward entry path mismatch');
  check(validatorDef?.slow === false, 'validate-broker-steward should be a fast validator');
  check(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-broker-steward') === true,
    'standard profile must include validate-broker-steward'
  );
}

ensureRequiredFiles();
ensureConfigWiring();

const tempRoot = createTempWorkspace('atm-broker-steward-');
try {
  initializeGitRepository(tempRoot);
  writeFileSync(path.join(tempRoot, 'package.json'), `${JSON.stringify({ name: 'atm-broker-steward-temp', private: true, type: 'module' }, null, 2)}\n`, 'utf8');
  const targetDir = path.join(tempRoot, 'src');
  const targetFile = path.join(targetDir, 'target.ts');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(targetFile, 'alpha\n', 'utf8');
  const taskDir = path.join(tempRoot, '.atm', 'history', 'tasks');
  mkdirSync(taskDir, { recursive: true });
  writeJson(path.join(taskDir, 'TASK-CID-0020.json'), {
    atomizationImpact: {
      ownerAtomOrMap: 'ATM-CORE-0020'
    }
  });
  const baseCommit = commitText(tempRoot, 'base target for steward fixture');
  const registryDir = path.join(tempRoot, '.atm', 'runtime');
  mkdirSync(registryDir, { recursive: true });
  writeJson(path.join(registryDir, 'write-broker.registry.json'), {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'local-repo',
    workspaceId: 'main',
    activeIntents: [
      {
        intentId: 'intent-fixture-0001',
        taskId: 'TASK-CID-0999',
        teamRunId: null,
        actorId: '009',
        baseCommit,
        resourceKeys: {
          files: ['src/occupied.ts'],
          atomIds: ['ATM-CORE-0999'],
          atomCids: ['cid-0999'],
          generators: [],
          projections: [],
          registries: [],
          validators: [],
          artifacts: []
        },
        leaseEpoch: Date.now(),
        lane: 'neutral-steward',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    ]
  });

  const proposal = makeProposal(baseCommit, hashFile(targetFile));
  const compose = composeBrokerProposals([proposal]);
  check(compose.mergePlan.verdict === 'parallel-safe', 'single proposal must compose to parallel-safe');

  const plan = planStewardApply({
    cwd: tempRoot,
    stewardId: 'neutral-write-steward',
    mergePlan: compose.mergePlan,
    proposals: [proposal],
    scopeFiles: ['src/target.ts']
  });
  check(plan.ok === true, 'steward plan must pass for valid scoped proposal');

  const evidencePath = path.join(tempRoot, 'steward-evidence.json');
  const apply = applyStewardPlan({
    cwd: tempRoot,
    stewardId: 'neutral-write-steward',
    mergePlan: compose.mergePlan,
    proposals: [proposal],
    scopeFiles: ['src/target.ts'],
    evidenceOutPath: evidencePath
  });
  check(apply.ok === true, 'steward apply must succeed for valid scoped proposal');
  check(readFileSync(targetFile, 'utf8') === 'beta\n', 'steward apply must write scoped file content');
  check(existsSync(evidencePath), 'steward apply must emit evidence file');
  check(apply.evidence.permissions.gitWrite === false, 'steward evidence must deny git.write');
  check(apply.evidence.permissions.taskLifecycle === false, 'steward evidence must deny task.lifecycle');
  check(apply.evidence.verdict === 'applied', 'steward evidence must record applied verdict');
  assertStewardApplyEvidence(apply.evidence, 'direct steward apply evidence');
  assertStewardApplyEvidence(JSON.parse(readFileSync(evidencePath, 'utf8')), 'persisted steward apply evidence');

  const scopeBlocked = planStewardApply({
    cwd: tempRoot,
    stewardId: 'neutral-write-steward',
    mergePlan: compose.mergePlan,
    proposals: [proposal],
    scopeFiles: ['src/other.ts']
  });
  check(scopeBlocked.ok === false, 'scope-lock mismatch must block steward plan');
  check(scopeBlocked.plan.issues.some((issue) => issue.code === 'scope-lock-mismatch'), 'scope-lock mismatch must be reported');
  const blockedEvidencePath = path.join(tempRoot, 'steward-blocked-evidence.json');
  const blockedApply = applyStewardPlan({
    cwd: tempRoot,
    stewardId: 'neutral-write-steward',
    mergePlan: compose.mergePlan,
    proposals: [proposal],
    scopeFiles: ['src/other.ts'],
    evidenceOutPath: blockedEvidencePath
  });
  check(blockedApply.ok === false, 'scope-lock mismatch must block steward apply');
  check(blockedApply.evidence.verdict === 'blocked', 'blocked steward apply must record blocked verdict');
  check((blockedApply.evidence.blockedReasons ?? []).some((reason) => reason.includes('scope-lock-mismatch')), 'blocked steward evidence must include scope-lock mismatch reason');
  assertStewardApplyEvidence(blockedApply.evidence, 'blocked steward apply evidence');
  assertStewardApplyEvidence(JSON.parse(readFileSync(blockedEvidencePath, 'utf8')), 'persisted blocked steward apply evidence');

  writeFileSync(targetFile, 'gamma\n', 'utf8');
  const hashDrift = planStewardApply({
    cwd: tempRoot,
    stewardId: 'neutral-write-steward',
    mergePlan: compose.mergePlan,
    proposals: [proposal],
    scopeFiles: ['src/target.ts']
  });
  check(hashDrift.ok === false, 'file hash drift must block steward plan');
  check(hashDrift.plan.issues.some((issue) => issue.code === 'file-hash-drift'), 'file hash drift must be reported');

  writeFileSync(targetFile, 'alpha\n', 'utf8');
  commitText(tempRoot, 'advance head for stale base commit');
  const stale = planStewardApply({
    cwd: tempRoot,
    stewardId: 'neutral-write-steward',
    mergePlan: compose.mergePlan,
    proposals: [proposal],
    scopeFiles: ['src/target.ts']
  });
  check(stale.ok === false, 'stale base commit must block steward plan');
  check(stale.plan.issues.some((issue) => issue.code === 'stale-base-commit'), 'stale base commit must be reported');

  const blockedMergePlan = { ...compose.mergePlan, verdict: 'blocked-cid-conflict' as const };
  const blockedPlan = planStewardApply({
    cwd: tempRoot,
    stewardId: 'neutral-write-steward',
    mergePlan: blockedMergePlan,
    proposals: [proposal],
    scopeFiles: ['src/target.ts']
  });
  check(blockedPlan.ok === false, 'blocked merge plan must block steward plan');
  check(blockedPlan.plan.issues.some((issue) => issue.code === 'blocked-merge-plan'), 'blocked merge plan must be reported');

  writeFileSync(targetFile, 'alpha\n', 'utf8');
  const headSha = spawnSync('git', ['-C', tempRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  check(headSha.status === 0, `git rev-parse HEAD failed: ${headSha.stderr || headSha.stdout}`);
  const freshBaseCommit = String(headSha.stdout ?? '').trim();
  const freshProposal = makeProposal(freshBaseCommit, hashFile(targetFile));
  const freshCompose = composeBrokerProposals([freshProposal]);
  const proposalFile = path.join(tempRoot, 'proposal.json');
  const mergePlanFile = path.join(tempRoot, 'merge-plan.json');
  writeJson(proposalFile, freshProposal);
  writeJson(mergePlanFile, freshCompose.mergePlan);

  const cliRuntime = await runAtm([
    'broker', 'runtime', 'activate',
    '--task', 'TASK-CID-0020',
    '--actor', '008',
    '--merge-plan-file', 'merge-plan.json',
    '--proposal-file', 'proposal.json',
    '--scope-file', 'src/target.ts',
    '--evidence-out', 'runtime-evidence.json'
  ], tempRoot);
  check(cliRuntime.exitCode === 0 && cliRuntime.parsed.ok === true, `broker runtime activate CLI must pass: ${JSON.stringify(cliRuntime.parsed)}`);
  check(
    cliRuntime.parsed.evidence?.handshake?.brokerLane?.virtualAtomInUseRegistry?.activeVirtualAtoms?.length === 1,
    'runtime activation must expose one virtual atom in-use record'
  );
  check(
    cliRuntime.parsed.evidence?.scopedWriteExecution?.virtualAtomInUseRegistry?.activeVirtualAtoms?.length === 1,
    'runtime activation must carry the same virtual atom in-use registry through steward execution'
  );

  const invalidMergePlanFile = path.join(tempRoot, 'invalid-merge-plan.json');
  writeJson(invalidMergePlanFile, { ...freshCompose.mergePlan, inputProposals: ['missing-proposal-id'] });
  const cliPlan = await runAtm([
    'broker', 'steward', 'plan',
    '--merge-plan-file', invalidMergePlanFile,
    '--proposal-file', proposalFile,
    '--scope-file', 'src/target.ts'
  ], tempRoot);
  check(cliPlan.parsed.ok === false, 'CLI plan must reject invalid merge-plan evidence');

  writeFileSync(targetFile, 'alpha\n', 'utf8');
  const cliPlanOk = await runAtm([
    'broker', 'steward', 'plan',
    '--merge-plan-file', 'merge-plan.json',
    '--proposal-file', 'proposal.json',
    '--scope-file', 'src/target.ts'
  ], tempRoot);
  check(cliPlanOk.exitCode === 0 && cliPlanOk.parsed.ok === true, `steward plan CLI must pass: ${JSON.stringify(cliPlanOk.parsed)}`);

  const cliApply = await runAtm([
    'broker', 'steward', 'apply',
    '--task', 'TASK-CID-0020',
    '--actor', '008',
    '--merge-plan-file', 'merge-plan.json',
    '--proposal-file', 'proposal.json',
    '--scope-file', 'src/target.ts',
    '--evidence-out', 'steward-evidence.json'
  ], tempRoot);
  check(cliApply.exitCode === 0 && cliApply.parsed.ok === true, `steward apply CLI must pass: ${JSON.stringify(cliApply.parsed)}`);
  check(
    cliApply.parsed.evidence?.scopedWriteExecution?.virtualAtomInUseRegistry?.activeVirtualAtoms?.length === 1,
    'steward apply CLI must carry the same virtual atom in-use registry'
  );
  assertStewardApplyEvidence(cliApply.parsed.evidence?.applyEvidence, 'CLI steward apply evidence');
  assertStewardApplyEvidence(JSON.parse(readFileSync(evidencePath, 'utf8')), 'CLI persisted steward apply evidence');

  console.log(`[broker-steward:${mode}] ok`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
