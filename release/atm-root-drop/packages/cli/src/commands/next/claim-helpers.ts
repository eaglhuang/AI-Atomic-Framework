import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runBroker } from '../broker.ts';
import { CliError } from '../shared.ts';
import { prepareTaskForClaim } from '../tasks/public-surface.ts';
import { projectGovernanceSharedSurfacesFromPaths } from '../../../../core/src/broker/global-resource-projection.ts';
import { normalizeTaskRouteStatus } from './intent-normalizers.ts';
import type { ImportedTaskSummary } from './route-predicates.ts';

export async function prepareImportedTaskForClaim(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
  readonly actorId: string;
}) {
  const normalizedStatus = normalizeTaskRouteStatus(input.task.status);
  const prepared = prepareTaskForClaim({
    cwd: input.cwd,
    taskId: input.task.workItemId,
    actorId: input.actorId,
    status: input.task.status,
    title: input.task.title,
    transitionCommand: `node atm.mjs next --claim --task ${input.task.workItemId} --actor ${input.actorId} --auto-intent --json`
  });
  return {
    taskId: input.task.workItemId,
    originalStatus: normalizedStatus,
    steps: prepared.steps.map((step) => ({
      action: step.action,
      evidence: {
        action: step.action,
        taskId: input.task.workItemId,
        actorId: input.actorId,
        status: step.status,
        transitionPath: step.transitionPath,
        importEvidencePath: step.importEvidencePath ?? null
      }
    }))
  };
}

export async function registerPreClaimBrokerTransaction(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly targetFiles: readonly string[];
}): Promise<Record<string, unknown>> {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: input.cwd, encoding: 'utf8' });
  const baseCommit = head.status === 0 ? head.stdout.trim() : '';
  if (!baseCommit) {
    throw new CliError('ATM_BROKER_TRANSACTION_BASE_MISSING', 'next --claim requires a resolvable HEAD before registering its Broker transaction.', { exitCode: 1 });
  }
  const intent = buildPreClaimWriteIntent({
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit,
    targetFiles: input.targetFiles
  });
  const intentPath = path.join(input.cwd, '.atm', 'runtime', 'broker-intents', `${input.taskId}.json`);
  mkdirSync(path.dirname(intentPath), { recursive: true });
  writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
  const result = await runBroker([
    'register', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId, '--intent-file', intentPath
  ]);
  const evidence = result && typeof result === 'object' && 'evidence' in result
    ? (result.evidence as Record<string, unknown>)
    : null;
  const queueAdmission = evidence?.queueAdmission;
  if (!queueAdmission || typeof queueAdmission !== 'object' || !('status' in queueAdmission)) {
    throw new CliError('ATM_BROKER_TRANSACTION_INVALID', 'Broker pre-claim registration returned no canonical queue admission.', { exitCode: 1 });
  }
  return {
    intentPath: path.relative(input.cwd, intentPath).replace(/\\/g, '/'),
    baseCommit,
    queueAdmission,
    brokerDecision: evidence.decision ?? null
  };
}

export function buildPreClaimWriteIntent(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly baseCommit: string;
  readonly targetFiles: readonly string[];
}) {
  const targetFiles = [...new Set(input.targetFiles.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))].sort();
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'next pre-claim Broker transaction' },
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit: input.baseCommit,
    targetFiles,
    atomRefs: [],
    sharedSurfaces: projectGovernanceSharedSurfacesFromPaths(targetFiles),
    requestedLane: 'auto'
  } as const;
}
