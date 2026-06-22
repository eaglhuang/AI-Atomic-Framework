import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateBrokerDecision } from '../packages/core/src/broker/decision.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../packages/core/src/broker/types.ts';

type Scenario = {
  id: string;
  title: string;
  description: string;
  activeIntent: ActiveWriteIntent;
  newIntent: WriteIntent;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirArg = process.argv.includes('--output-dir')
  ? process.argv[process.argv.indexOf('--output-dir') + 1]
  : 'docs/reports/split-suggestion-evidence';
const outputDir = path.resolve(root, outputDirArg);
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildRegistry(activeIntent: ActiveWriteIntent): WriteBrokerRegistryDocument {
  const nowEpoch = Date.now();
  const freshIntent: ActiveWriteIntent = {
    ...activeIntent,
    leaseEpoch: nowEpoch,
    heartbeatAt: new Date(nowEpoch).toISOString(),
    expiresAt: new Date(nowEpoch + activeIntent.leaseSeconds * 1000).toISOString()
  };
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'split-suggestion-evidence',
    workspaceId: 'main',
    currentEpoch: nowEpoch,
    activeIntents: [freshIntent]
  };
}

const scenarios: Scenario[] = [
  {
    id: 'same-owner-blocked-suggestion',
    title: 'Same owner map blocked conflict with split suggestion',
    description: 'Two writers share the same owner map atomId, overlap on one bounded line, and remain blocked while the broker emits a split suggestion.',
    activeIntent: {
      intentId: 'intent-same-owner-a',
      taskId: 'TASK-SAME-OWNER-A',
      teamRunId: null,
      actorId: 'agent-a',
      baseCommit: 'base-same-owner',
      resourceKeys: {
        files: ['packages/cli/src/commands/broker.ts'],
        atomIds: ['atm.hot-owner-map'],
        atomCids: ['cid-owner-a'],
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: [],
        atomRanges: [{
          filePath: 'packages/cli/src/commands/broker.ts',
          lineStart: 1,
          lineEnd: 20,
          atomCid: 'cid-owner-a'
        }]
      },
      leaseEpoch: 1,
      leaseSeconds: 1800,
      leaseMaxSeconds: 1800,
      heartbeatAt: '2026-01-01T00:00:00.000Z',
      lane: 'direct-brokered',
      admission: {
        trigger: 'hot-file',
        state: 'proposal-submitted',
        requiresProposal: true,
        summarySubmitted: true,
        hotFiles: ['packages/cli/src/commands/broker.ts'],
        boundedRegions: [{
          filePath: 'packages/cli/src/commands/broker.ts',
          lineStart: 1,
          lineEnd: 20
        }],
        rearbitrationRequired: false,
        reason: 'Seed same-owner writer.'
      }
    },
    newIntent: {
      schemaId: 'atm.writeIntent.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'same owner split suggestion evidence' },
      taskId: 'TASK-SAME-OWNER-B',
      actorId: 'agent-b',
      baseCommit: 'base-same-owner',
      targetFiles: ['packages/cli/src/commands/broker.ts'],
      atomRefs: [{
        atomId: 'atm.hot-owner-map',
        atomCid: 'cid-owner-b',
        operation: 'modify',
        sourceRange: {
          filePath: 'packages/cli/src/commands/broker.ts',
          lineStart: 10,
          lineEnd: 10
        }
      }],
      sharedSurfaces: {
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      requestedLane: 'auto',
      proposalAdmission: {
        trigger: 'same-file-overlap-risk',
        summarySubmitted: true,
        boundedRegions: [{
          filePath: 'packages/cli/src/commands/broker.ts',
          lineStart: 10,
          lineEnd: 10
        }],
        notes: 'Overlapping same-owner joiner should be blocked but produce a split suggestion.'
      }
    }
  },
  {
    id: 'same-owner-close-orch-suggestion',
    title: 'Same owner map blocked conflict on close-orchestration with split suggestion',
    description: 'A second coarse owner-map example on close-orchestration stays blocked but emits a bounded split suggestion for the overlapping region.',
    activeIntent: {
      intentId: 'intent-close-orch-a',
      taskId: 'TASK-CLOSE-ORCH-A',
      teamRunId: null,
      actorId: 'agent-a',
      baseCommit: 'base-close-orch',
      resourceKeys: {
        files: ['packages/cli/src/commands/taskflow/close-orchestration.ts'],
        atomIds: ['atm.close-orchestration-map'],
        atomCids: ['cid-close-orch-a'],
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: [],
        atomRanges: [{
          filePath: 'packages/cli/src/commands/taskflow/close-orchestration.ts',
          lineStart: 120,
          lineEnd: 180,
          atomCid: 'cid-close-orch-a'
        }]
      },
      leaseEpoch: 1,
      leaseSeconds: 1800,
      leaseMaxSeconds: 1800,
      heartbeatAt: '2026-01-01T00:00:00.000Z',
      lane: 'direct-brokered',
      admission: {
        trigger: 'hot-file',
        state: 'proposal-submitted',
        requiresProposal: true,
        summarySubmitted: true,
        hotFiles: ['packages/cli/src/commands/taskflow/close-orchestration.ts'],
        boundedRegions: [{
          filePath: 'packages/cli/src/commands/taskflow/close-orchestration.ts',
          lineStart: 120,
          lineEnd: 180
        }],
        rearbitrationRequired: false,
        reason: 'Seed close-orchestration owner-map writer.'
      }
    },
    newIntent: {
      schemaId: 'atm.writeIntent.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'close orchestration split suggestion evidence' },
      taskId: 'TASK-CLOSE-ORCH-B',
      actorId: 'agent-b',
      baseCommit: 'base-close-orch',
      targetFiles: ['packages/cli/src/commands/taskflow/close-orchestration.ts'],
      atomRefs: [{
        atomId: 'atm.close-orchestration-map',
        atomCid: 'cid-close-orch-b',
        operation: 'modify',
        sourceRange: {
          filePath: 'packages/cli/src/commands/taskflow/close-orchestration.ts',
          lineStart: 146,
          lineEnd: 150
        }
      }],
      sharedSurfaces: {
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      requestedLane: 'auto',
      proposalAdmission: {
        trigger: 'same-file-overlap-risk',
        summarySubmitted: true,
        boundedRegions: [{
          filePath: 'packages/cli/src/commands/taskflow/close-orchestration.ts',
          lineStart: 146,
          lineEnd: 150
        }],
        notes: 'Overlapping close-orchestration joiner should be blocked but produce a split suggestion.'
      }
    }
  }
];

const rows = scenarios.map((scenario) => {
  const decision = calculateBrokerDecision(scenario.newIntent, buildRegistry(scenario.activeIntent));
  const artifact = {
    schemaId: 'atm.splitSuggestionEvidence.v1',
    scenarioId: scenario.id,
    title: scenario.title,
    description: scenario.description,
    decision
  };
  writeJson(path.join(outputDir, `${scenario.id}.json`), artifact);
  return {
    id: scenario.id,
    title: scenario.title,
    verdict: decision.verdict,
    lane: decision.lane,
    reason: decision.reason,
    suggestion: decision.decompositionRequest
      ? `${decision.decompositionRequest.targetFunction.atomId} @ ${decision.decompositionRequest.conflictRegion.filePath}:${decision.decompositionRequest.conflictRegion.lineStart}-${decision.decompositionRequest.conflictRegion.lineEnd}`
      : 'none',
    suggestionKind: decision.decompositionRequest?.suggestionKind ?? 'none',
    suggestedAtoms: decision.decompositionRequest?.suggestedAtoms?.map((atom) => `${atom.role}:${atom.atomId}:${atom.sourceRange.lineStart}-${atom.sourceRange.lineEnd}`) ?? []
  };
});

const reportLines = [
  '# Split Suggestion Evidence',
  '',
  '| scenario | verdict | lane | suggestion kind | suggestion | suggested atoms |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((row) => `| ${row.id} | ${row.verdict} | ${row.lane} | ${row.suggestionKind} | ${row.suggestion} | ${row.suggestedAtoms.join('<br>')} |`),
  '',
  '## Notes',
  '',
  '- `same-owner-blocked-suggestion`: same owner map remains blocked, but now emits a bounded split suggestion instead of only a hard stop.',
  '- `same-owner-close-orch-suggestion`: the same split-suggestion behavior also appears on a second coarse owner map, showing the output is not tied to one file or one hot-file case.'
];

writeFileSync(path.join(outputDir, 'split-suggestion-evidence-zh.md'), `${reportLines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, outputDir, rows }, null, 2));
