import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runCli } from '../../packages/cli/src/atm.ts';
import {
  enrichCommandResult,
  makeResult,
  message
} from '../../packages/cli/src/commands/shared.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliResultSchema = JSON.parse(readFileSync(path.join(repoRoot, 'schemas/governance/cli-result.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateCliResult = ajv.compile(cliResultSchema);

function captureCli(args: string[]) {
  let stdout = '';
  let stderr = '';
  const exitCodePromise = runCli(args, {
    stdout: { write(chunk: string) { stdout += chunk; return true; } },
    stderr: { write(chunk: string) { stderr += chunk; return true; } }
  } as any);
  return exitCodePromise.then((exitCode) => ({
    exitCode,
    stdout,
    stderr,
    payload: JSON.parse((stdout || stderr).trim())
  }));
}

// === unit: severity taxonomy ===
const advisory = enrichCommandResult(makeResult({
  ok: true,
  command: 'upgrade',
  cwd: process.cwd(),
  messages: [message('warn', 'ATM_UPGRADE_PROPOSAL_BLOCKED', 'blocked gates', {})]
}));
assert.equal(advisory.severity, 'advisory');
assert.equal(advisory.exitCode, 0);
assert.equal(advisory.blocking, false);

const blocked = enrichCommandResult(makeResult({
  ok: false,
  command: 'next',
  cwd: process.cwd(),
  messages: [message('error', 'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED', 'switch repo', {})],
  evidence: {
    taskIntent: {
      schemaId: 'atm.taskIntent.v1',
      userPrompt: 'complete selected cards',
      taskScopeMentioned: true
    },
    nextAction: {
      status: 'blocked',
      allowedCommands: ['node atm.mjs next --json'],
      blockedCommands: ['node atm.mjs next --claim --json'],
      runnerMode: { schemaId: 'atm.runnerMode.v1', mode: 'frozen' },
      skillGrowth: {
        schemaId: 'atm.skillGrowthHints.v1',
        categories: ['tooling-mismatch'],
        durableRule: 'Diagnose runner skew before retrying lifecycle routes.'
      }
    },
    userNotice: { schemaVersion: 'atm.userNotice.v0.1', spokenLine: 'notice' }
  }
}));
assert.equal(blocked.severity, 'blocked');
assert.equal(blocked.exitCode, 1);
assert.equal(blocked.blocking, true);
assert.equal(blocked.nextAction?.status, 'blocked');
assert.deepEqual(blocked.allowedCommands, ['node atm.mjs next --json']);
assert.deepEqual(blocked.blockedCommands, ['node atm.mjs next --claim --json']);
assert.equal(blocked.runnerMode?.schemaId, 'atm.runnerMode.v1');
assert.equal(blocked.taskIntent?.schemaId, 'atm.taskIntent.v1');
assert.equal(blocked.userNotice?.schemaVersion, 'atm.userNotice.v0.1');
assert.equal(blocked.skillGrowth?.schemaId, 'atm.skillGrowthHints.v1');

const frameworkStatusProjection = enrichCommandResult(makeResult({
  ok: true,
  command: 'framework-mode',
  cwd: process.cwd(),
  messages: [message('info', 'ATM_FRAMEWORK_MODE_STATUS', 'Framework development mode is required.', {})],
  evidence: {
    action: 'status',
    report: {
      schemaId: 'atm.frameworkDevelopmentStatus',
      mode: 'required',
      repoRole: 'framework'
    }
  }
}));
assert.equal(frameworkStatusProjection.frameworkReport?.schemaId, 'atm.frameworkDevelopmentStatus');

const frameworkClaimProjection = enrichCommandResult(makeResult({
  ok: true,
  command: 'framework-mode',
  cwd: process.cwd(),
  messages: [message('info', 'ATM_FRAMEWORK_TEMP_CLAIM_ACQUIRED', 'claimed', {})],
  evidence: {
    action: 'claim',
    taskId: 'ATM-FRAMEWORK-TEMP-codex-main',
    actorId: 'codex-main',
    reason: 'bridge inspection',
    linkedTaskId: 'TASK-SKL-0003',
    files: ['packages/cli/src/commands/next.ts'],
    lock: { lockId: 'lock-1' }
  }
}));
assert.equal(frameworkClaimProjection.frameworkClaim?.action, 'claim');
assert.deepEqual(frameworkClaimProjection.frameworkClaim?.files, ['packages/cli/src/commands/next.ts']);
assert.equal(frameworkClaimProjection.frameworkClaim?.linkedTaskId, 'TASK-SKL-0003');

const evidenceProjection = enrichCommandResult(makeResult({
  ok: true,
  command: 'evidence',
  cwd: process.cwd(),
  messages: [message('info', 'ATM_EVIDENCE_ADDED', 'added', {})],
  evidence: {
    action: 'add',
    taskId: 'TASK-SKL-0004',
    actorId: 'codex-main',
    kind: 'test',
    evidencePath: '.atm/history/evidence/TASK-SKL-0004.json',
    commandRunCount: 1,
    commandRunCache: { schemaId: 'atm.commandRunCache.v1', runCount: 1 },
    bundleManifestPath: '.atm/history/evidence/TASK-SKL-0004.bundle-manifest.json',
    bundleManifest: {
      freshValidationPasses: ['git diff --check'],
      artifactPaths: ['artifacts/report.json']
    }
  }
}));
assert.equal(evidenceProjection.evidenceSummary?.taskId, 'TASK-SKL-0004');
assert.deepEqual(evidenceProjection.evidenceSummary?.freshValidationPasses, ['git diff --check']);
assert.deepEqual(evidenceProjection.evidenceSummary?.artifactPaths, ['artifacts/report.json']);

const guardProjection = enrichCommandResult(makeResult({
  ok: false,
  command: 'guard',
  cwd: process.cwd(),
  messages: [message('error', 'ATM_GUARD_MUTATION_FAILED', 'failed', {})],
  evidence: {
    guard: 'mutation',
    taskId: 'TASK-SKL-0004',
    actorId: 'codex-main',
    files: ['packages/cli/src/commands/taskflow/close-orchestration.ts'],
    violations: [{ code: 'scope-outside', detail: 'outside scope' }],
    report: { schemaId: 'atm.guardMutationReport.v1' }
  }
}));
assert.equal(guardProjection.guardReport?.guard, 'mutation');
assert.equal(Array.isArray(guardProjection.guardReport?.violations), true);
assert.equal((guardProjection.guardReport?.report as any)?.schemaId, 'atm.guardMutationReport.v1');

const taskflowProjection = enrichCommandResult(makeResult({
  ok: false,
  command: 'taskflow pre-close',
  cwd: process.cwd(),
  messages: [message('warn', 'ATM_TASKFLOW_PRECLOSE_BLOCKED', 'blocked', {})],
  evidence: {
    closeMode: 'normal-close',
    writeReadinessHint: { schemaId: 'atm.taskflowCloseWriteReadinessHint.v1', status: 'blocked' },
    historicalClosePreflight: { schemaId: 'atm.historicalClosePreflight.v1', ok: false },
    autoEvidencePlan: { schemaId: 'atm.autoEvidencePlan.v1', ok: false },
    closebackPathResolution: { route: 'missing' }
  }
}));
assert.equal((taskflowProjection.taskflowReadiness?.writeReadinessHint as any)?.schemaId, 'atm.taskflowCloseWriteReadinessHint.v1');
assert.equal((taskflowProjection.taskflowReadiness?.historicalClosePreflight as any)?.schemaId, 'atm.historicalClosePreflight.v1');
assert.equal(taskflowProjection.taskflowReadiness?.closeMode, 'normal-close');

const commitBundleProjection = enrichCommandResult(makeResult({
  ok: true,
  command: 'git',
  cwd: process.cwd(),
  messages: [message('info', 'ATM_GIT_COMMIT_BUNDLE_DRY_RUN', 'bundle ready', {})],
  evidence: {
    action: 'commit',
    commitBundle: {
      schemaId: 'atm.taskScopedCommitBundle.v1',
      taskId: 'TASK-SKL-0004',
      ok: true,
      stageFiles: ['packages/cli/src/commands/taskflow/close-orchestration.ts'],
      outOfScopeStagedFiles: ['schemas/governance/cli-result.schema.json']
    }
  }
}));
assert.equal(commitBundleProjection.commitBundle?.schemaId, 'atm.taskScopedCommitBundle.v1');
assert.deepEqual(commitBundleProjection.commitBundle?.outOfScopeStagedFiles, ['schemas/governance/cli-result.schema.json']);

const usage = enrichCommandResult(makeResult({
  ok: false,
  command: 'help',
  cwd: process.cwd(),
  messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', 'unknown', {})]
}));
assert.equal(usage.severity, 'usage-error');
assert.equal(usage.exitCode, 2);
assert.equal(usage.blocking, true);

const failure = enrichCommandResult(makeResult({
  ok: false,
  command: 'doctor',
  cwd: process.cwd(),
  messages: [message('error', 'ATM_DOCTOR_GIT_EVIDENCE_MISSING', 'missing evidence', {})]
}));
assert.equal(failure.severity, 'failure');
assert.equal(failure.exitCode, 1);
assert.equal(failure.blocking, true);

const success = enrichCommandResult(makeResult({
  ok: true,
  command: 'status',
  cwd: process.cwd(),
  messages: [message('info', 'ATM_STATUS_READY', 'ready', {})]
}));
assert.equal(success.severity, 'success');
assert.equal(success.exitCode, 0);
assert.equal(success.blocking, false);

assert.equal(validateCliResult(blocked), true, JSON.stringify(validateCliResult.errors, null, 2));
assert.equal(validateCliResult(success), true, JSON.stringify(validateCliResult.errors, null, 2));

// === smoke: process exit + JSON contract ===
const help = await captureCli(['help', '--json']);
assert.equal(help.exitCode, 0);
assert.equal(help.payload.ok, true);
assert.equal(help.payload.severity, 'success');
assert.equal(help.payload.exitCode, 0);
assert.equal(help.payload.blocking, false);
assert.ok(help.payload.diagnostics);
assert.equal(validateCliResult(help.payload), true, JSON.stringify(validateCliResult.errors, null, 2));

const unknown = await captureCli(['not-a-real-command', '--json']);
assert.equal(unknown.exitCode, 2);
assert.equal(unknown.payload.ok, false);
assert.equal(unknown.payload.severity, 'usage-error');
assert.equal(unknown.payload.exitCode, 2);
assert.equal(unknown.payload.blocking, true);
assert.ok(unknown.payload.diagnostics.errorCodes.includes('ATM_CLI_UNKNOWN_COMMAND'));
assert.equal(validateCliResult(unknown.payload), true, JSON.stringify(validateCliResult.errors, null, 2));

console.log('[cli-result-contract:test] ok');
