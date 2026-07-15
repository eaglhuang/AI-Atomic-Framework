import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { evaluateClaimAdmission } from '../../../packages/cli/src/commands/next/claim-admission.ts';
import {
  buildClaimAdmissionDecisionLog,
  CLAIM_ADMISSION_DECISION_LOG_KEYS,
  CLAIM_ADMISSION_GATE_NAMES
} from '../../../packages/cli/src/commands/next/claim-conflict-log.ts';
import { restrictTeamWriteScopeForQueueAdmission } from '../../../packages/cli/src/commands/next/broker-queue-admission.ts';
import { resolveAtomizationLinePolicy } from '../../../packages/cli/src/commands/tasks/task-import-validators.ts';
import { reportTeamAgentsCaseOk } from './reporter.ts';

export async function runNextClaimAtomizationValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'next-claim-atomization') return false;

  const lineBudget = resolveAtomizationLinePolicy({ config: readRepoConfig(process.cwd()) }).maxLines;
  const ownerModules = [
    'packages/cli/src/commands/next/broker-queue-admission.ts',
    'packages/cli/src/commands/next/claim-admission.ts',
    'packages/cli/src/commands/next/claim-conflict-log.ts'
  ];
  const atomDirectory = path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'next');
  const atomFiles = readdirSync(atomDirectory).filter((entry) => entry.endsWith('.ts'));
  for (const moduleFile of [...ownerModules, ...atomFiles.map((entry) => `packages/cli/src/commands/next/${entry}`)]) {
    const lineCount = readFileSync(path.join(process.cwd(), moduleFile), 'utf8').split('\n').length;
    assert.ok(lineCount < lineBudget, `${moduleFile} must stay under ${lineBudget} lines (found ${lineCount})`);
  }
  const atomMap = JSON.parse(readFileSync(path.join(process.cwd(), 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), 'utf8')) as { entries?: Record<string, unknown> } & Record<string, unknown>;
  const atomMapText = JSON.stringify(atomMap);
  for (const moduleFile of ownerModules) {
    assert.ok(atomMapText.includes(moduleFile), `atom map must contain an entry for ${moduleFile}`);
  }
  const queueAdmission = {
    schemaId: 'atm.brokerQueueAdmission.v1',
    taskId: 'TASK-A',
    status: 'queued-private-work',
    allowedFiles: ['src/private-a.ts'],
    queuedSharedPaths: ['src/shared.ts'],
    waitingOn: [{ surfacePath: 'src/shared.ts', queueHeadTaskId: 'TASK-B', position: 2 }],
    reason: 'Shared paths remain queued; the task may claim only its disjoint private paths.'
  } as const;
  const admittedDecision = evaluateClaimAdmission({
    brokerVerdict: 'watch',
    cidVerdict: 'parallel-safe-with-cid-overlap-advisory',
    candidateTaskId: 'TASK-A',
    conflictingTaskId: 'TASK-B',
    overlappingAtomIds: ['atom-1']
  });
  const admittedLog = buildClaimAdmissionDecisionLog({
    taskId: 'TASK-A',
    conflictTaskId: 'TASK-B',
    claimIntent: 'write',
    activeWriteConflict: false,
    confirmedBrokerConflict: false,
    insufficientMutationIntent: false,
    cidVerdict: 'parallel-safe-with-cid-overlap-advisory',
    brokerVerdict: 'watch',
    queueAdmission,
    overlappingFiles: ['src\\shared.ts', 'src/alpha.ts', 'src/shared.ts'],
    decision: admittedDecision,
    admissionReason: 'broker-shared-surface-queue-private-work'
  });
  assert.deepEqual(Object.keys(admittedLog), [...CLAIM_ADMISSION_DECISION_LOG_KEYS], 'decision log keys must stay stable');
  assert.deepEqual(admittedLog.gates.map((gate) => gate.gate), [...CLAIM_ADMISSION_GATE_NAMES], 'seven gate names must stay stable');
  assert.equal(admittedLog.gates.length, 7, 'decision log must explain exactly seven gates');
  assert.deepEqual(admittedLog.sharedPathOrder, ['src/alpha.ts', 'src/shared.ts'], 'shared path order must be normalized and sorted');
  assert.equal(admittedLog.queue.position, 2, 'queue position must surface the waiting position');
  assert.equal(admittedLog.privatePathAllowance.granted, true, 'private-path allowance must be granted for queued-private-work');
  assert.equal(admittedLog.admitted, true);
  assert.equal(admittedLog.blockReason, null);
  const blockedDecision = evaluateClaimAdmission({
    brokerVerdict: 'freeze',
    cidVerdict: 'blocked-cid-conflict',
    candidateTaskId: 'TASK-A',
    conflictingTaskId: 'TASK-B',
    overlappingAtomIds: ['atom-1']
  });
  const blockedLog = buildClaimAdmissionDecisionLog({
    taskId: 'TASK-A',
    conflictTaskId: 'TASK-B',
    claimIntent: 'write',
    activeWriteConflict: true,
    confirmedBrokerConflict: true,
    insufficientMutationIntent: false,
    cidVerdict: 'blocked-cid-conflict',
    brokerVerdict: 'freeze',
    queueAdmission: null,
    overlappingFiles: ['src/shared.ts'],
    decision: blockedDecision,
    admissionReason: null
  });
  assert.equal(blockedLog.admitted, false);
  assert.ok(blockedLog.blockReason && blockedLog.blockReason.includes('broker-conflict-blocked'), 'blocked log must carry the block reason');
  assert.equal(blockedLog.queue.status, 'not-evaluated');
  assert.equal(blockedLog.privatePathAllowance.granted, false);
  const serialized = JSON.stringify(admittedLog) + JSON.stringify(blockedLog);
  assert.equal(serialized.includes('redactedPreview'), false, 'decision log must not leak task body content');
  const restricted = restrictTeamWriteScopeForQueueAdmission(queueAdmission, ['src/private-a.ts', 'src/shared.ts']);
  assert.equal(restricted.verdict, 'restricted-private-work');
  assert.deepEqual(restricted.writePaths, ['src/private-a.ts'], 'queued-private-work must restrict team write scope to the disjoint private paths');
  const rejected = restrictTeamWriteScopeForQueueAdmission({ ...queueAdmission, status: 'queued-blocked', allowedFiles: [] }, ['src/shared.ts']);
  assert.equal(rejected.verdict, 'rejected');
  assert.deepEqual(rejected.writePaths, [], 'queued-blocked must reject with an empty team write scope');
  const unrestricted = restrictTeamWriteScopeForQueueAdmission({ ...queueAdmission, status: 'queue-head', queuedSharedPaths: [], waitingOn: [] }, ['src/shared.ts', 'src/private-a.ts']);
  assert.equal(unrestricted.verdict, 'unrestricted');
  assert.deepEqual(unrestricted.writePaths, ['src/private-a.ts', 'src/shared.ts'], 'queue-head must keep, and never widen, the input scope');
  reportTeamAgentsCaseOk('next-claim-atomization');
  return true;
}

function readRepoConfig(cwd: string): { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } } | null {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, 'utf8')) as { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } };
}
