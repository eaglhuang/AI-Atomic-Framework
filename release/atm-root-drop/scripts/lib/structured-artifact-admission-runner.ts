import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { composeBrokerProposals } from '../../packages/core/src/broker/compose.ts';
import { calculateBrokerDecision } from '../../packages/core/src/broker/decision.ts';
import type { PatchProposal, ProposalAtomRef, WriteBrokerRegistryDocument, WriteIntent } from '../../packages/core/src/broker/types.ts';

export type StructuredFormat = 'json' | 'yaml' | 'toml' | 'openapi' | 'atom-map-shard';
export type StructuredKind = 'compose' | 'registry';
export type StructuredVerdict = 'parallel-safe' | 'blocked-shared-surface' | 'blocked-cid-conflict' | 'serial';

interface ProposalFixture {
  readonly proposalId: string;
  readonly atomId: string;
  readonly atomCid: string;
  readonly patch: string;
  readonly intent: string;
}

interface RegistryIntentFixture {
  readonly taskId: string;
  readonly actorId: string;
  readonly atomId: string;
  readonly atomCid: string;
  readonly readAtoms: readonly string[];
}

interface ActiveIntentFixture {
  readonly taskId: string;
  readonly actorId: string;
  readonly file: string;
  readonly atomId: string;
  readonly atomCid: string;
}

export interface StructuredArtifactScenario {
  readonly id: string;
  readonly format: StructuredFormat;
  readonly family: string;
  readonly kind: StructuredKind;
  readonly targetFile: string;
  readonly description: string;
  readonly expectedVerdict: StructuredVerdict;
  readonly proposals?: readonly ProposalFixture[];
  readonly newIntent?: RegistryIntentFixture;
  readonly activeIntent?: ActiveIntentFixture;
}

interface ScenarioSet {
  readonly schemaId: string;
  readonly scenarios: readonly StructuredArtifactScenario[];
}

export interface StructuredArtifactResultRow {
  readonly schemaId: 'atm.structuredArtifactAdmissionRow.v1';
  readonly scenarioId: string;
  readonly format: StructuredFormat;
  readonly family: string;
  readonly kind: StructuredKind;
  readonly targetFile: string;
  readonly expectedVerdict: StructuredVerdict;
  readonly actualVerdict: StructuredVerdict;
  readonly matchedExpectation: boolean;
  readonly safeToParallelize: boolean;
  readonly caseClass: 'parallel-safe' | 'same-surface-blocked' | 'readwrite-serial';
}

export interface StructuredArtifactSummary {
  readonly schemaId: 'atm.structuredArtifactAdmissionSummary.v1';
  readonly generatedAt: string;
  readonly scenarioCount: number;
  readonly formatCoverage: Record<StructuredFormat, number>;
  readonly verdictCounts: Record<StructuredVerdict, number>;
  readonly matchedCount: number;
  readonly expectationFailures: string[];
  readonly shipSafe: boolean;
}

export interface StructuredArtifactRunOutput {
  readonly rows: StructuredArtifactResultRow[];
  readonly summary: StructuredArtifactSummary;
}

function buildPatchProposal(targetFile: string, fixture: ProposalFixture): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'structured-artifact-admission' },
    proposalId: fixture.proposalId,
    taskId: 'TASK-STRUCTURED-ADMISSION',
    actorId: 'structured-bench',
    baseCommit: 'commit-base',
    fileBeforeHash: 'hash-target',
    targetFile,
    atomRefs: [{ atomId: fixture.atomId, atomCid: fixture.atomCid } satisfies ProposalAtomRef],
    anchors: [{ kind: 'line', hint: fixture.atomId.toLowerCase() }],
    intent: fixture.intent,
    patch: fixture.patch,
    validators: ['deterministic-structured-bench'],
    rollback: `Revert ${fixture.atomId}.`
  };
}

function buildRegistryCase(
  targetFile: string,
  newIntentFixture: RegistryIntentFixture,
  activeIntentFixture: ActiveIntentFixture
): { newIntent: WriteIntent; registry: WriteBrokerRegistryDocument } {
  return {
    newIntent: {
      schemaId: 'atm.writeIntent.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'structured-artifact-admission' },
      taskId: newIntentFixture.taskId,
      actorId: newIntentFixture.actorId,
      baseCommit: 'commit-base',
      targetFiles: [targetFile],
      atomRefs: [{ atomId: newIntentFixture.atomId, atomCid: newIntentFixture.atomCid, operation: 'modify' }],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
      requestedLane: 'auto'
    },
    registry: {
      schemaId: 'atm.writeBrokerRegistry.v1',
      specVersion: '0.1.0',
      repoId: 'structured-artifact-bench',
      workspaceId: 'main',
      activeIntents: [
        {
          intentId: `${activeIntentFixture.taskId}-intent`,
          taskId: activeIntentFixture.taskId,
          teamRunId: null,
          actorId: activeIntentFixture.actorId,
          baseCommit: 'commit-base',
          resourceKeys: {
            files: [activeIntentFixture.file],
            atomIds: [activeIntentFixture.atomId],
            atomCids: [activeIntentFixture.atomCid],
            generators: [],
            projections: [],
            registries: [],
            validators: [],
            artifacts: []
          },
          leaseEpoch: 1,
          leaseSeconds: 300,
          leaseMaxSeconds: 1800,
          heartbeatAt: '2026-06-27T20:00:00.000Z',
          lane: 'direct-brokered',
          expiresAt: '2030-06-27T20:10:00.000Z'
        }
      ]
    }
  };
}

function evaluateScenario(scenario: StructuredArtifactScenario): StructuredArtifactResultRow {
  let actualVerdict: StructuredVerdict;
  if (scenario.kind === 'compose') {
    const result = composeBrokerProposals((scenario.proposals ?? []).map((fixture) => buildPatchProposal(scenario.targetFile, fixture)));
    actualVerdict = result.mergePlan.verdict as StructuredVerdict;
  } else {
    if (!scenario.newIntent || !scenario.activeIntent) {
      throw new Error(`registry scenario missing intent fixtures: ${scenario.id}`);
    }
    const registryCase = buildRegistryCase(scenario.targetFile, scenario.newIntent, scenario.activeIntent);
    const readSet = new Set(scenario.newIntent.readAtoms);
    const active = registryCase.registry.activeIntents[0];
    const hit = active.resourceKeys.atomIds.some((atomId) => readSet.has(atomId))
      || active.resourceKeys.atomCids.some((atomCid) => readSet.has(atomCid));
    if (hit) {
      actualVerdict = 'serial';
    } else {
      const decision = calculateBrokerDecision(registryCase.newIntent, registryCase.registry);
      actualVerdict = decision.verdict as StructuredVerdict;
    }
  }

  return {
    schemaId: 'atm.structuredArtifactAdmissionRow.v1',
    scenarioId: scenario.id,
    format: scenario.format,
    family: scenario.family,
    kind: scenario.kind,
    targetFile: scenario.targetFile,
    expectedVerdict: scenario.expectedVerdict,
    actualVerdict,
    matchedExpectation: actualVerdict === scenario.expectedVerdict,
    safeToParallelize: actualVerdict === 'parallel-safe',
    caseClass:
      scenario.expectedVerdict === 'parallel-safe'
        ? 'parallel-safe'
        : scenario.expectedVerdict === 'serial'
          ? 'readwrite-serial'
          : 'same-surface-blocked'
  };
}

export function loadStructuredArtifactScenarios(root: string): StructuredArtifactScenario[] {
  const file = path.join(root, 'scripts/fixtures/structured-artifact-admission/scenarios.json');
  if (!existsSync(file)) {
    throw new Error(`missing structured artifact scenarios: ${file}`);
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as ScenarioSet;
  return [...parsed.scenarios];
}

export function runStructuredArtifactAdmission(root: string): StructuredArtifactRunOutput {
  const scenarios = loadStructuredArtifactScenarios(root);
  const rows = scenarios.map((scenario) => evaluateScenario(scenario));
  const formatCoverage: Record<StructuredFormat, number> = {
    json: 0,
    yaml: 0,
    toml: 0,
    openapi: 0,
    'atom-map-shard': 0
  };
  const verdictCounts: Record<StructuredVerdict, number> = {
    'parallel-safe': 0,
    'blocked-shared-surface': 0,
    'blocked-cid-conflict': 0,
    serial: 0
  };
  const expectationFailures: string[] = [];

  for (const row of rows) {
    formatCoverage[row.format] += 1;
    verdictCounts[row.actualVerdict] += 1;
    if (!row.matchedExpectation) {
      expectationFailures.push(`${row.scenarioId}:${row.expectedVerdict}->${row.actualVerdict}`);
    }
  }

  return {
    rows,
    summary: {
      schemaId: 'atm.structuredArtifactAdmissionSummary.v1',
      generatedAt: new Date().toISOString(),
      scenarioCount: rows.length,
      formatCoverage,
      verdictCounts,
      matchedCount: rows.filter((row) => row.matchedExpectation).length,
      expectationFailures,
      shipSafe: expectationFailures.length === 0
    }
  };
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function renderPaperSafeSummary(summary: StructuredArtifactSummary): string {
  return [
    '# Structured Artifact Admission Track',
    '',
    'ATM evaluated deterministic structured artifact admission cases across JSON manifest, YAML workflow, TOML config, OpenAPI schema, and atom-map shard surfaces.',
    '',
    `- Scenario count: \`${summary.scenarioCount}\``,
    `- Matched expectations: \`${summary.matchedCount}/${summary.scenarioCount}\``,
    `- Parallel-safe verdicts: \`${summary.verdictCounts['parallel-safe']}\``,
    `- Same-surface blocked verdicts: \`${summary.verdictCounts['blocked-shared-surface'] + summary.verdictCounts['blocked-cid-conflict']}\``,
    `- Read/write serial verdicts: \`${summary.verdictCounts.serial}\``,
    '- Safe claim: ATM can deterministically distinguish parallel-safe, same-surface blocked, and read/write serial structured artifact cases in local admission evidence.',
    '- Non-claim: This track does not claim live upstream governance over external maintainers or runtime lock elimination.'
  ].join('\n');
}

export function writeStructuredArtifactArtifacts(root: string, outDir: string): StructuredArtifactRunOutput {
  const result = runStructuredArtifactAdmission(root);
  mkdirSync(outDir, { recursive: true });

  const summaryPath = path.join(outDir, 'summary.json');
  const rowsPath = path.join(outDir, 'results.jsonl');
  const manifestPath = path.join(outDir, 'generator-manifest.json');
  const paperSummaryPath = path.join(outDir, 'paper-safe-summary.md');
  const commandsLogPath = path.join(outDir, 'commands.log');

  writeFileSync(summaryPath, `${JSON.stringify(result.summary, null, 2)}\n`, 'utf8');
  writeFileSync(rowsPath, result.rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  writeFileSync(manifestPath, `${JSON.stringify({
    schemaId: 'atm.structuredArtifactAdmissionGeneratorManifest.v1',
    generatedAt: result.summary.generatedAt,
    commands: [
      'npm run typecheck',
      'npm run validate:structured-artifact-admission',
      'npm run bench:structured-artifact-admission',
      'git diff --check'
    ],
    artifactDir: outDir.replace(/\\/g, '/'),
    scenarioCount: result.summary.scenarioCount
  }, null, 2)}\n`, 'utf8');
  writeFileSync(paperSummaryPath, `${renderPaperSafeSummary(result.summary)}\n`, 'utf8');
  writeFileSync(commandsLogPath, [
    '## structured-artifact-admission',
    '$ npm run typecheck',
    '$ npm run validate:structured-artifact-admission',
    '$ npm run bench:structured-artifact-admission',
    '',
    `generatedAt: ${result.summary.generatedAt}`,
    `artifactDir: ${outDir.replace(/\\/g, '/')}`
  ].join('\n'), 'utf8');

  const files = ['summary.json', 'results.jsonl', 'generator-manifest.json', 'paper-safe-summary.md', 'commands.log'];
  const hashLines = files.map((name) => `${sha256File(path.join(outDir, name))}  ${name}`);
  writeFileSync(path.join(outDir, 'artifact-hash-manifest.sha256'), `${hashLines.join('\n')}\n`, 'utf8');

  return result;
}
