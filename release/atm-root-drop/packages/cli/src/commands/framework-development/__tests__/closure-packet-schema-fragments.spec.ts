import assert from 'node:assert/strict';
import { pushSha256ValidationIssue } from '../closure-packet/diagnostics.ts';
import type { ClosurePacket, ClosurePacketCommandRun } from '../closure-packet/schema-fragments.ts';
import type { ClosurePacketValidationIssue, ClosurePacketValidationResult } from '../closure-packet/validator-contract.ts';
import { validateClosurePacket } from '../closure-packet-schema.ts';

const digest = `sha256:${'a'.repeat(64)}`;

const commandRun: ClosurePacketCommandRun = {
  command: 'npm run typecheck',
  cwd: '.',
  exitCode: 0,
  stdoutSha256: digest,
  stderrSha256: digest,
  runnerVersion: 'test'
};

const packet: ClosurePacket = {
  schemaId: 'atm.closurePacket.v1',
  specVersion: '0.1.0',
  taskId: 'TASK-RFT-0025',
  targetRepoIdentity: {
    isFrameworkRepo: true,
    score: 5,
    root: '/repo',
    name: 'ai-atomic-framework',
    signals: ['package-name:ai-atomic-framework']
  },
  targetCommit: 'abc123',
  governedTreeSha: 'tree123',
  targetCommitDelta: {
    currentCommitSha: 'abc123',
    parentCommitShas: ['parent123'],
    governedTreeSha: 'tree123',
    changedFiles: ['packages/cli/src/commands/framework-development/closure-packet-schema.ts']
  },
  closedByCommand: 'atm tasks close',
  commandRuns: [commandRun],
  validationPasses: ['typecheck', 'validate:cli'],
  evidenceFreshness: 'fresh',
  requiredGates: ['typecheck', 'validate:cli'],
  requiredGatesSnapshot: {
    schemaId: 'atm.requiredGatesSnapshot.v1',
    generatedAt: '2026-07-13T00:00:00.000Z',
    source: 'frameworkStatus.requiredGates',
    ruleVersion: '0.1.0',
    frameworkMode: 'required',
    repoRole: 'framework',
    changedFiles: ['packages/cli/src/commands/framework-development/closure-packet-schema.ts'],
    criticalChangedFiles: ['packages/cli/src/commands/framework-development/closure-packet-schema.ts'],
    requiredGates: ['typecheck', 'validate:cli']
  },
  evidencePath: '.atm/history/evidence/TASK-RFT-0025.json',
  closedAt: '2026-07-13T00:00:00.000Z',
  closedByActor: 'Codex-GPT 5.5',
  sessionId: null
};

const validation: ClosurePacketValidationResult = validateClosurePacket(packet);
assert.equal(validation.ok, true);

const issues: { missing: string[]; invalidFormat: ClosurePacketValidationIssue[] } = { missing: [], invalidFormat: [] };
pushSha256ValidationIssue(issues, 'commandRuns/0/stdoutSha256', 'sha256:not-valid');
assert.equal(issues.invalidFormat[0]?.path, 'commandRuns/0/stdoutSha256');
assert.match(issues.invalidFormat[0]?.formatExpected ?? '', /sha256/);

console.log('[closure-packet-schema-fragments.spec] ok');
