#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../packages/cli/src/atm.ts';
import { runRegistry } from '../packages/cli/src/commands/registry.ts';
import { runRegistryDiff } from '../packages/cli/src/commands/registry-diff.ts';
import { createMapEquivalenceReport } from '../packages/core/src/equivalence/run-map-equivalence.ts';
import { createPropagationReport } from '../packages/core/src/test-runner/propagation.ts';
import { createStubReviewAdvisoryReport } from '../packages/plugin-review-advisory/src/index.ts';
import {
  createHumanReviewDecisionLog,
  createHumanReviewQueueRecord
} from '../packages/plugin-human-review/src/index.ts';
import { createTempWorkspace } from './temp-root.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'test';
const prefix = `[registry-lineage-backfill:${mode}]`;
const fixture = readJson(path.join(repoRoot, 'tests/registry-fixtures/adopter-lineage.fixture.json'));
const timestamp = '2026-05-20T00:00:00.000Z';

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(`${prefix} FAIL: ${message}`);
  }
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runAtm(args: string[], cwd: string) {
  const previousCwd = process.cwd();
  let stdout = '';
  let stderr = '';
  process.chdir(cwd);
  let exitCode = 1;
  try {
    const io = {
      stdout: { write: (value: string) => { stdout += value; return true; } },
      stderr: { write: (value: string) => { stderr += value; return true; } }
    } as any;
    exitCode = await runCli(args, io);
  } finally {
    process.chdir(previousCwd);
  }
  const payload = (stdout || stderr || '').trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(payload);
  } catch (error: any) {
    throw new Error(`${prefix} FAIL: CLI output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
  }
  return {
    exitCode,
    stdout,
    stderr,
    parsed
  };
}

function createFixtureWorkspace() {
  const workspace = createTempWorkspace('atm-registry-lineage-backfill-');
  const entry = fixture.missingLineageRegistryDocument.entries[0];
  const mapRoot = path.join(workspace, 'atomic_workbench/maps/ATM-MAP-0001');
  mkdirSync(mapRoot, { recursive: true });

  const mapSpec = {
    schemaId: 'atm.atomicMap',
    specVersion: entry.specVersion,
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Registry lineage backfill validator map fixture.'
    },
    mapId: entry.mapId,
    mapVersion: entry.mapVersion,
    members: entry.members,
    edges: entry.edges,
    entrypoints: entry.entrypoints,
    qualityTargets: entry.qualityTargets,
    mapHash: entry.mapHash,
    replacement: entry.replacement,
    lineageLogRef: entry.lineageLogRef
  };
  writeJson(path.join(workspace, 'atomic-registry.json'), fixture.missingLineageRegistryDocument);
  writeJson(path.join(workspace, entry.location.specPath), mapSpec);
  writeJson(path.join(workspace, 'atomic_workbench/maps/ATM-MAP-0001/lineage-log.json'), {
    schemaId: 'atm.mapLineageLog',
    specVersion: '0.1.0',
    canonicalMapId: entry.mapId,
    generatedAt: timestamp,
    versionLineage: fixture.registryDocument.entries[0].members[0].versionLineage,
    transitions: [
      {
        from: 'shadow',
        to: 'active',
        reason: 'Fixture map promotion retained as lineage evidence.',
        evidenceRefs: entry.evidence,
        actor: 'validate-registry-lineage-backfill',
        timestamp
      }
    ]
  });

  const equivalencePath = 'atomic_workbench/maps/ATM-MAP-0001/map.equivalence.report.json';
  writeJson(path.join(workspace, equivalencePath), createMapEquivalenceReport({
    mapId: entry.mapId,
    generatedAt: timestamp,
    specPath: entry.location.specPath,
    fixturePath: 'atomic_workbench/maps/ATM-MAP-0001/equivalence.fixture.json',
    reportPath: equivalencePath,
    legacyUris: entry.replacement.legacyUris,
    fixtureSetId: 'registry-lineage-backfill',
    cases: [
      {
        caseId: 'lineage-backfill-happy-path',
        input: { atomId: fixture.atomId },
        expected: { ok: true },
        actual: { ok: true },
        metric: {
          name: 'exact-match',
          baseline: 1,
          current: 1,
          delta: 0,
          direction: 'higher-is-better',
          passed: true
        },
        evidenceRefs: [entry.location.specPath],
        passed: true,
        knownDivergence: false
      }
    ],
    documentedKnownDivergenceIds: [],
    failedCaseIds: [],
    durationMs: 0
  }));

  const propagationPath = 'atomic_workbench/maps/ATM-MAP-0001/propagation.report.json';
  writeJson(path.join(workspace, propagationPath), createPropagationReport({
    ok: true,
    atomId: fixture.atomId,
    discoveredMaps: [entry.mapId],
    perMapStatus: [
      {
        mapId: entry.mapId,
        ok: true,
        exitCode: 0,
        durationMs: 0,
        resolutionMode: 'canonical',
        reportPath: entry.location.reportPath,
        warnings: []
      }
    ],
    failedDownstream: [],
    propagationDuration: 0,
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      durationMs: 0
    }
  }, {
    atomId: fixture.atomId,
    reportId: 'propagation.registry-lineage-backfill',
    generatedAt: timestamp
  }));

  const reviewPath = 'atomic_workbench/maps/ATM-MAP-0001/review-advisory.report.json';
  writeJson(path.join(workspace, reviewPath), createStubReviewAdvisoryReport({
    profile: 'pass',
    reportId: 'review-advisory.registry-lineage-backfill',
    target: {
      kind: 'map',
      id: entry.mapId
    }
  }));

  const humanReviewPath = 'atomic_workbench/maps/ATM-MAP-0001/human-review.decision.json';
  const proposal = {
    proposalId: 'proposal.atm-npcbrain-0002.0.1.0-to-0.1.1.map-bump',
    atomId: fixture.atomId,
    fromVersion: fixture.fromVersion,
    toVersion: fixture.toVersion,
    decompositionDecision: 'map-bump',
    automatedGates: {
      allPassed: true,
      blockedGateNames: []
    },
    status: 'pending',
    proposedAt: timestamp,
    target: {
      kind: 'map',
      mapId: entry.mapId
    }
  };
  const queueRecord = createHumanReviewQueueRecord(proposal, { queuedAt: timestamp });
  writeJson(path.join(workspace, humanReviewPath), createHumanReviewDecisionLog({
    queueRecord,
    decision: 'approve',
    reason: 'Approved registry lineage backfill from adopter evidence.',
    decidedBy: 'validate-registry-lineage-backfill',
    decidedAt: timestamp,
    queuePath: 'atomic_workbench/maps/ATM-MAP-0001/human-review.queue.json',
    projectionPath: humanReviewPath
  }));

  return {
    workspace,
    paths: {
      registryPath: 'atomic-registry.json',
      specPath: entry.location.specPath,
      lineageLogPath: 'atomic_workbench/maps/ATM-MAP-0001/lineage-log.json',
      equivalencePath,
      propagationPath,
      reviewPath,
      humanReviewPath
    }
  };
}

function backfillArgs(paths: Record<string, string>, modeFlag: '--dry-run' | '--apply') {
  return [
    'lineage',
    'backfill',
    '--atom',
    fixture.atomId,
    '--from',
    fixture.fromVersion,
    '--to',
    fixture.toVersion,
    '--map',
    'ATM-MAP-0001',
    '--registry',
    paths.registryPath,
    '--lineage-log',
    paths.lineageLogPath,
    '--equivalence',
    paths.equivalencePath,
    '--propagation',
    paths.propagationPath,
    '--review',
    paths.reviewPath,
    '--human-review',
    paths.humanReviewPath,
    '--actor',
    'validate-registry-lineage-backfill',
    '--at',
    timestamp,
    modeFlag
  ];
}

async function run() {
  const first = createFixtureWorkspace();
  try {
    const registryBefore = readFileSync(path.join(first.workspace, first.paths.registryPath), 'utf8');
    const specBefore = readFileSync(path.join(first.workspace, first.paths.specPath), 'utf8');
    const lineageBefore = readFileSync(path.join(first.workspace, first.paths.lineageLogPath), 'utf8');

    const dryRun: any = runRegistry(['--cwd', first.workspace, ...backfillArgs(first.paths, '--dry-run')]);
    assert(dryRun.ok === true, 'dry-run must succeed with complete evidence');
    assert(dryRun.evidence.dryRun === true, 'dry-run must report dryRun=true');
    assert(dryRun.evidence.patch.registry.operations[0].op === 'add', 'dry-run patch must add member versionLineage');
    assert(dryRun.evidence.registryDiff.driftSummary.totalChanged === 3, 'dry-run must trigger registry-diff after simulated patch');
    assert(readFileSync(path.join(first.workspace, first.paths.registryPath), 'utf8') === registryBefore, 'dry-run must not mutate registry');
    assert(readFileSync(path.join(first.workspace, first.paths.specPath), 'utf8') === specBefore, 'dry-run must not mutate map spec');
    assert(readFileSync(path.join(first.workspace, first.paths.lineageLogPath), 'utf8') === lineageBefore, 'dry-run must not mutate lineage log');

    const missingHumanReview: any = runRegistry([
      '--cwd',
      first.workspace,
      ...backfillArgs(first.paths, '--apply').filter((entry, index, entries) => entry !== '--human-review' && entries[index - 1] !== '--human-review')
    ]);
    assert(missingHumanReview.ok === false, 'apply must fail when human-review evidence is missing');
    assert(missingHumanReview.messages[0].code === 'ATM_REGISTRY_LINEAGE_EVIDENCE_MISSING', 'missing evidence must return ATM_REGISTRY_LINEAGE_EVIDENCE_MISSING');
  } finally {
    rmSync(first.workspace, { recursive: true, force: true });
  }

  const second = createFixtureWorkspace();
  try {
    const apply: any = runRegistry(['--cwd', second.workspace, ...backfillArgs(second.paths, '--apply')]);
    assert(apply.ok === true, 'apply must succeed with complete evidence');
    assert(apply.evidence.applied === true, 'apply must report applied=true');
    assert(apply.evidence.closeoutReportPath.endsWith('.json'), 'apply must report closeout evidence path');

    const registry = readJson(path.join(second.workspace, second.paths.registryPath));
    const member = registry.entries[0].members[0];
    assert(member.versionLineage.currentVersion === fixture.toVersion, 'registry member versionLineage must be backfilled to target version');
    assert(member.versionLineage.versions.length === 2, 'registry member versionLineage must preserve full history');

    const spec = readJson(path.join(second.workspace, second.paths.specPath));
    assert(spec.members[0].versionLineage.currentVersion === fixture.toVersion, 'map spec member versionLineage must be backfilled');

    const lineageLog = readJson(path.join(second.workspace, second.paths.lineageLogPath));
    assert(Array.isArray(lineageLog.versionBackfills) && lineageLog.versionBackfills.length === 1, 'apply must record a lineage-log backfill event');

    const closeoutPath = path.join(second.workspace, apply.evidence.closeoutReportPath);
    assert(existsSync(closeoutPath), 'apply must write closeout evidence');
    const closeout = readJson(closeoutPath);
    assert(closeout.registryDiff.driftSummary.totalChanged === 3, 'closeout evidence must embed registry-diff output');

    const diff: any = runRegistryDiff([
      fixture.atomId,
      '--from',
      fixture.fromVersion,
      '--to',
      fixture.toVersion,
      '--registry',
      path.join(second.workspace, second.paths.registryPath)
    ]);
    assert(diff.ok === true, 'registry-diff must succeed after backfill');
    assert(diff.evidence.sourceKind === 'member-version-lineage', 'registry-diff must resolve through member-version-lineage after backfill');
    assert(diff.evidence.totalChanged === 3, 'registry-diff must preserve the expected hash drift count');

    const cliDryRun = await runAtm(['registry', '--cwd', second.workspace, ...backfillArgs(second.paths, '--dry-run'), '--json'], second.workspace);
    assert(cliDryRun.exitCode === 0, 'atm registry lineage backfill --dry-run must exit 0 through the CLI entrypoint');
    assert(cliDryRun.parsed.ok === true, 'CLI dry-run must report ok=true');
    assert(cliDryRun.parsed.evidence.registryDiff.driftSummary.totalChanged === 3, 'CLI dry-run must trigger registry-diff output');
  } finally {
    rmSync(second.workspace, { recursive: true, force: true });
  }

  console.log(`${prefix} ok`);
}

try {
  await run();
} catch (error: any) {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
}
