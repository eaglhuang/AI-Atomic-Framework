import assert from 'node:assert/strict';
import {
  ATM_ONLY_EXECUTION_ROUTE_NOTICE,
  RESTRICTED_EXECUTION_RECEIPT_SCHEMA_ID,
  describeRestrictedExecutionAdapterCapability,
  describeRestrictedExecutionPolicy,
  evaluateRestrictedExecution
} from '../../packages/core/src/team-agents/restricted-execution-gateway.ts';
import { evaluateTeamWorkerExecutionRequest } from '../../packages/core/src/team-agents/worker-executor.ts';

const now = '2026-07-28T00:00:00.000Z';

const authority = {
  actor: 'worker-1',
  taskId: 'TASK-GIT-0016',
  laneSessionId: 'lane-1'
} as const;

function worker(executable: string, argv: readonly string[], overrides: Record<string, unknown> = {}) {
  return evaluateRestrictedExecution({
    ...authority,
    executionClass: 'external-worker-process',
    executable,
    argv,
    cwd: '.',
    adapterCapability: 'enforced',
    now,
    ...overrides
  });
}

// ─── Mutation shapes fail closed before process launch ──────────────────────

const rawGitCommit = worker('git', ['commit', '-m', 'unsafe']);
assert.equal(rawGitCommit.decision, 'deny', 'raw git commit must be denied before execution');
assert.equal(rawGitCommit.reasonCode, 'raw-git-mutation');
assert.match(rawGitCommit.approvedAtmCommand, /node atm\.mjs git commit/);
assert.equal(rawGitCommit.receipt.schemaId, RESTRICTED_EXECUTION_RECEIPT_SCHEMA_ID);
assert.equal(rawGitCommit.receipt.riskLevel, 'governed-git-required');
assert.equal(rawGitCommit.receipt.actor, 'worker-1');
assert.equal(rawGitCommit.receipt.taskId, 'TASK-GIT-0016');
assert.equal(rawGitCommit.receipt.laneSessionId, 'lane-1');
assert.match(rawGitCommit.receipt.requestDigest, /^sha256:[a-f0-9]{64}$/);

assert.equal(worker('git', ['push', 'origin', 'main']).reasonCode, 'raw-git-mutation');
assert.equal(worker('git', ['reset', '--hard']).receipt.riskLevel, 'destructive');
assert.equal(worker('git', ['restore', '--staged', '--', 'a.ts']).receipt.riskLevel, 'stage-only');
assert.equal(worker('git', ['clean', '-fd']).receipt.riskLevel, 'destructive');

// Interpreter evaluation, in every spelling the incident produced.
for (const argv of [['-e', 'require("fs").writeFileSync("x","y")'], ['--eval', 'x'], ['--eval=x'], ['-pe', 'x']]) {
  const denied = worker('node', argv);
  assert.equal(denied.decision, 'deny', `node ${argv.join(' ')} must be denied`);
  assert.equal(denied.reasonCode, 'interpreter-evaluation');
  assert.equal(denied.receipt.riskLevel, 'interpreter-escape');
}
assert.equal(worker('python3', ['-c', 'open("x","w")']).reasonCode, 'interpreter-evaluation');

// Shell escapes, including a fully-qualified Windows executable path.
assert.equal(worker('powershell', ['-Command', 'Set-Content x y']).reasonCode, 'shell-command-escape');
assert.equal(worker('pwsh', ['-File', 'write.ps1']).reasonCode, 'shell-command-escape');
assert.equal(worker('cmd', ['/c', 'echo hi > x']).reasonCode, 'shell-command-escape');
assert.equal(worker('bash', ['-c', 'rm -rf .']).reasonCode, 'shell-command-escape');
assert.equal(worker('C:\\Windows\\System32\\cmd.exe', ['/c', 'x']).reasonCode, 'shell-command-escape');
assert.equal(worker('/usr/bin/git', ['commit', '-m', 'x']).reasonCode, 'raw-git-mutation');

// ─── Allowed routes ────────────────────────────────────────────────────────

const governed = worker('node', ['atm.mjs', 'git', 'commit', '--actor', 'worker-1', '--json']);
assert.equal(governed.decision, 'allow', 'the ATM governed wrapper is the normal mutation path');
assert.equal(governed.reasonCode, 'approved-atm-command');

const readOnlyGit = worker('git', ['status', '--short']);
assert.equal(readOnlyGit.decision, 'allow');
assert.equal(readOnlyGit.reasonCode, 'allowlisted-read-only-command');

const validator = evaluateRestrictedExecution({
  executionClass: 'read-only-validator',
  executable: 'node',
  argv: ['--strip-types', 'scripts/validate-skill-templates.ts', '--mode', 'validate'],
  cwd: '.',
  now
});
assert.equal(validator.decision, 'allow', 'an allowlisted read-only validator with declared cwd is admitted');
assert.equal(validator.reasonCode, 'allowlisted-read-only-command');

const npmValidator = evaluateRestrictedExecution({
  executionClass: 'read-only-validator',
  executable: 'npm',
  argv: ['run', 'validate:skill-templates'],
  cwd: '.',
  now
});
assert.equal(npmValidator.decision, 'allow');

// There is no generic shell fallback for a validator.
const shellWrappedValidator = evaluateRestrictedExecution({
  executionClass: 'read-only-validator',
  executable: 'bash',
  argv: ['-c', 'npm run validate:skill-templates'],
  cwd: '.',
  now
});
assert.equal(shellWrappedValidator.decision, 'deny');
assert.equal(shellWrappedValidator.reasonCode, 'shell-command-escape');

const validatorWithoutCwd = evaluateRestrictedExecution({
  executionClass: 'read-only-validator',
  executable: 'npm',
  argv: ['run', 'validate:skill-templates'],
  now
});
assert.equal(validatorWithoutCwd.decision, 'deny', 'a validator must declare its working directory');
assert.equal(validatorWithoutCwd.reasonCode, 'missing-execution-authority');

const writingValidator = evaluateRestrictedExecution({
  executionClass: 'read-only-validator',
  executable: 'npm',
  argv: ['run', 'validate:skill-templates'],
  cwd: '.',
  declaredOutputs: ['dist/out.json'],
  now
});
assert.equal(writingValidator.decision, 'deny', 'a validator that declares writes is not a read-only validator');
assert.equal(writingValidator.reasonCode, 'validator-declares-writes');

// A worker executable outside the allowlist fails closed on the strict surface.
assert.equal(worker('rsync', ['-a', 'src', 'dst']).reasonCode, 'executable-not-allowlisted');

// ─── Authority, outputs, and adapter capability fail closed ────────────────

for (const missing of ['actor', 'taskId', 'laneSessionId'] as const) {
  const denied = worker('node', ['atm.mjs', 'git', 'commit', '--json'], { [missing]: null });
  assert.equal(denied.decision, 'deny', `missing ${missing} must fail closed`);
  assert.equal(denied.reasonCode, 'missing-execution-authority');
}

const wrongCapability = worker('node', ['atm.mjs', 'git', 'commit', '--json'], { adapterCapability: 'unsupported' });
assert.equal(wrongCapability.decision, 'deny');
assert.equal(wrongCapability.reasonCode, 'external-write-capability-unsupported');

const manifestWithoutOutputs = evaluateRestrictedExecution({
  ...authority,
  executionClass: 'command-manifest',
  executable: 'npm',
  argv: ['run', 'build'],
  cwd: '.',
  adapterCapability: 'enforced',
  now
});
assert.equal(manifestWithoutOutputs.decision, 'deny', 'a generated write must declare its outputs');
assert.equal(manifestWithoutOutputs.reasonCode, 'undeclared-output');

const manifestWithOutputs = evaluateRestrictedExecution({
  ...authority,
  executionClass: 'command-manifest',
  executable: 'npm',
  argv: ['run', 'build'],
  cwd: '.',
  declaredOutputs: ['dist/atm.js'],
  adapterCapability: 'enforced',
  now
});
assert.equal(manifestWithOutputs.decision, 'allow');
assert.equal(manifestWithOutputs.reasonCode, 'declared-generated-write-command');

const manifestEval = evaluateRestrictedExecution({
  ...authority,
  executionClass: 'command-manifest',
  executable: process.execPath,
  argv: ['-e', 'require("fs").writeFileSync("out.txt","ok")'],
  cwd: '.',
  declaredOutputs: ['out.txt'],
  adapterCapability: 'enforced',
  now
});
assert.equal(manifestEval.decision, 'deny', 'a shell-less node -e write is still an interpreter escape');
assert.equal(manifestEval.reasonCode, 'interpreter-evaluation');

// ─── Text can never grant permission ───────────────────────────────────────

const withOverridePhrase = worker('git', ['reset', '--hard', '#', 'ATM-DESTRUCTIVE-GIT-OVERRIDE-I-UNDERSTAND-THIS-CAN-DESTROY-ANOTHER-ACTIVE-AGENT-WORK']);
assert.equal(withOverridePhrase.decision, 'deny', 'an override phrase in argv must not unlock a denied command');
assert.equal(withOverridePhrase.receipt.overridePolicy.promptTextAccepted, false);
assert.equal(withOverridePhrase.receipt.overridePolicy.environmentVariableAccepted, false);

process.env.ATM_ALLOW_RAW_GIT = '1';
const withEnvVariable = worker('git', ['reset', '--hard']);
delete process.env.ATM_ALLOW_RAW_GIT;
assert.equal(withEnvVariable.decision, 'deny', 'an environment variable must not unlock a denied command');

const noticeCarrier = worker('node', ['-e', ATM_ONLY_EXECUTION_ROUTE_NOTICE]);
assert.equal(noticeCarrier.decision, 'deny', 'quoting the warning text must not authorize the command');

// ─── Two adapters observe the same normalized decision ─────────────────────

const viaWorkerAdapter = evaluateTeamWorkerExecutionRequest({
  lane: { taskId: 'TASK-GIT-0016', laneSessionId: 'lane-1' },
  actorId: 'worker-1',
  executable: 'git',
  argv: ['reset', '--hard'],
  cwd: '.',
  now
});
const viaPreToolAdapter = evaluateRestrictedExecution({
  ...authority,
  executionClass: 'editor-pre-tool',
  executable: 'git',
  argv: ['reset', '--hard'],
  cwd: '.',
  adapterCapability: describeRestrictedExecutionAdapterCapability('claude-code'),
  now
});
assert.equal(viaWorkerAdapter.decision, viaPreToolAdapter.decision);
assert.equal(viaWorkerAdapter.reasonCode, viaPreToolAdapter.reasonCode);
assert.equal(viaWorkerAdapter.approvedAtmCommand, viaPreToolAdapter.approvedAtmCommand);
assert.equal(viaWorkerAdapter.receipt.riskLevel, viaPreToolAdapter.receipt.riskLevel);

// The lane supplies authority, so a worker cannot name a different task.
assert.equal(viaWorkerAdapter.receipt.taskId, 'TASK-GIT-0016');

// ─── Adapter capability advertisement ──────────────────────────────────────

assert.equal(describeRestrictedExecutionAdapterCapability('claude-code'), 'enforced');
assert.equal(describeRestrictedExecutionAdapterCapability('copilot'), 'enforced');
for (const adapterId of ['cursor', 'gemini', 'codex', 'antigravity', '', null]) {
  assert.equal(describeRestrictedExecutionAdapterCapability(adapterId), 'unsupported', `${adapterId} must not advertise external write capability`);
}

// ─── Guidance projection comes from real evaluations ───────────────────────

const policy = describeRestrictedExecutionPolicy(now);
assert.equal(policy.schemaId, 'atm.restrictedExecutionGuidance.v1');
assert.equal(policy.notice, ATM_ONLY_EXECUTION_ROUTE_NOTICE);
assert.equal(policy.overridePolicy.promptTextAccepted, false);
assert.ok(policy.deniedExamples.length >= 6, 'guidance must project every denied sample');
for (const example of policy.deniedExamples) {
  assert.ok(example.approvedAtmCommand.startsWith('node atm.mjs '), 'every denial must name an ATM recovery command');
}

// Receipts must not echo reusable privileged material back to the caller.
const secretCarrying = worker('node', ['-e', 'process.env.SUPER_SECRET_TOKEN_VALUE_1234567890']);
assert.equal(JSON.stringify(secretCarrying.receipt).includes('SUPER_SECRET_TOKEN_VALUE_1234567890'), false, 'receipt must record argv classes, not raw argument text');

console.log('[restricted-execution-gateway] ok');
