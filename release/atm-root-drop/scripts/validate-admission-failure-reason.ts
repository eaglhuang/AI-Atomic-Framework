import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { calculateBrokerDecision } from '../packages/core/src/broker/decision.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../packages/core/src/broker/types.ts';
import { createValidator } from './lib/validator-harness.ts';

const harness = createValidator('admission-failure-reason', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

const artifactDir = harness.repoPath('artifacts', 'generated', 'admission-failure-reason', '20260628');
const artifactGeneratedAt = '2026-06-28T00:00:00.000Z';

function makeIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'admission-failure-reason' },
    taskId: 'TASK-A',
    actorId: 'agent-a',
    baseCommit: 'abc123',
    targetFiles: ['src/shared.ts'],
    atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    requestedLane: 'auto',
    ...overrides
  };
}

function toActiveIntent(intent: WriteIntent, intentId: string): ActiveWriteIntent {
  return {
    intentId,
    taskId: intent.taskId,
    teamRunId: null,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    resourceKeys: {
      files: intent.targetFiles,
      atomIds: intent.atomRefs.map((ref) => ref.atomId),
      atomCids: intent.atomRefs.map((ref) => ref.atomCid),
      atomRanges: intent.atomRefs
        .map((ref) => ref.sourceRange && ({ ...ref.sourceRange, atomCid: ref.atomCid }))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      generators: intent.sharedSurfaces.generators,
      projections: intent.sharedSurfaces.projections,
      registries: intent.sharedSurfaces.registries,
      validators: intent.sharedSurfaces.validators,
      artifacts: intent.sharedSurfaces.artifacts
    },
    leaseEpoch: 1,
    leaseSeconds: 600,
    leaseMaxSeconds: 1800,
    heartbeatAt: '2026-06-28T00:00:00.000Z',
    lane: 'direct-brokered'
  };
}

function registryWith(intents: readonly ActiveWriteIntent[]): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'paper-evidence',
    workspaceId: 'main',
    activeIntents: intents
  };
}

const cases = [
  {
    id: 'blocked-shared-surface',
    decision: calculateBrokerDecision(
      makeIntent({
        taskId: 'TASK-B',
        actorId: 'agent-b',
        sharedSurfaces: { generators: ['gen-hot'], projections: [], registries: [], validators: [], artifacts: [] }
      }),
      registryWith([toActiveIntent(makeIntent({
        sharedSurfaces: { generators: ['gen-hot'], projections: [], registries: [], validators: [], artifacts: [] }
      }), 'intent-a')])
    )
  },
  {
    id: 'blocked-cid-conflict',
    decision: calculateBrokerDecision(
      makeIntent({
        taskId: 'TASK-B',
        actorId: 'agent-b',
        atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }]
      }),
      registryWith([toActiveIntent(makeIntent(), 'intent-a')])
    )
  },
  {
    id: 'composer-routed-disjoint-file-range',
    decision: calculateBrokerDecision(
      makeIntent({
        taskId: 'TASK-B',
        actorId: 'agent-b',
        atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }]
      }),
      registryWith([toActiveIntent(makeIntent({
        targetFiles: ['src/shared.ts'],
        atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }]
      }), 'intent-a')])
    )
  }
];

mkdirSync(artifactDir, { recursive: true });

const summary = {
  schemaId: 'atm.admissionFailureReasonSummary.v1',
  generatedAt: artifactGeneratedAt,
  cases: cases.map((entry) => ({
    id: entry.id,
    verdict: entry.decision.verdict,
    failureReason: entry.decision.failureReason ?? null
  }))
};

const summaryPath = path.join(artifactDir, 'summary.json');
const rowsPath = path.join(artifactDir, 'results.jsonl');
const paperPath = path.join(artifactDir, 'paper-safe-summary.md');
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
writeFileSync(rowsPath, `${cases.map((entry) => JSON.stringify({
  scenarioId: entry.id,
  verdict: entry.decision.verdict,
  failureReason: entry.decision.failureReason
})).join('\n')}\n`, 'utf8');
writeFileSync(paperPath, [
  '# AdmissionFailureReason',
  '',
  '- Safe claim: blocked and composer-routed broker decisions now preserve a structured failureReason payload for repair/context handoff.',
  '- Non-claim: failureReason is an additive explanation envelope, not a proof of full validator transcript capture.',
  '',
  ...cases.map((entry) => `- ${entry.id}: \`${entry.decision.verdict}\` -> \`${entry.decision.failureReason?.blockingLayer ?? 'none'}\` / \`${entry.decision.failureReason?.recommendedRoute ?? 'direct'}\``)
].join('\n') + '\n', 'utf8');

const hash = (filePath: string) => createHash('sha256').update(harness.readText(path.relative(harness.root, filePath))).digest('hex');
writeFileSync(
  path.join(artifactDir, 'artifact-hash-manifest.sha256'),
  ['summary.json', 'results.jsonl', 'paper-safe-summary.md']
    .map((name) => `${hash(path.join(artifactDir, name))}  ${name}`)
    .join('\n') + '\n',
  'utf8'
);

harness.assert(cases.every((entry) => entry.decision.verdict === 'parallel-safe' || entry.decision.failureReason), 'non-parallel broker decisions must emit failureReason');
harness.ok(`cases=${cases.length}`);
