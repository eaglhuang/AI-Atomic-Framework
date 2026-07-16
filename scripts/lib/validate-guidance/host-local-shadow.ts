import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { probeProject } from '../../../packages/core/src/guidance/index.ts';
import { createTempWorkspace } from '../../temp-root.ts';

type AtmJsonResult = {
  readonly exitCode: number;
  readonly parsed: Record<string, any>;
};

type HostLocalShadowAssertionsContext = {
  readonly root: string;
  readonly assert: (condition: unknown, message: string) => void;
  readonly requireFile: (relativePath: string, message: string) => void;
  readonly runAtmJsonPortable: (args: string[], cwd?: string) => Promise<AtmJsonResult>;
};

export async function runHostLocalShadowEvidenceAssertions({
  root,
  assert,
  requireFile,
  runAtmJsonPortable
}: HostLocalShadowAssertionsContext): Promise<void> {
  // ── Phase: config-driven legacy hotspot guidance ──────────────────────────────
  const downstreamFixtureRoot = path.join(root, 'tests/guidance-fixtures/downstream-legacy-config');
  requireFile('tests/guidance-fixtures/downstream-legacy-config/.atm/config.json', 'missing downstream config fixture');
  requireFile('tests/guidance-fixtures/downstream-legacy-config/src/downstream-helper.js', 'missing downstream helper fixture');

  const downstreamOrientation = probeProject(downstreamFixtureRoot);
  assert(Array.isArray(downstreamOrientation.configLegacyHotspots) && downstreamOrientation.configLegacyHotspots.length > 0,
    'config hotspot fixture must surface configLegacyHotspots');
  assert(downstreamOrientation.configLegacyHotspots[0].path === 'src/downstream-helper.js',
    'config hotspot path must match fixture');
  assert(downstreamOrientation.configLegacyHotspots[0].releaseBlockers.includes('processRequest'),
    'config hotspot must declare processRequest as release blocker');
  assert(downstreamOrientation.defaultLegacyFlow === 'shadow',
    'config must declare defaultLegacyFlow=shadow');
  assert(downstreamOrientation.noTouchZones.some((z) => z.path.includes('processRequest')),
    'config no-touch zones must be merged into orientation.noTouchZones');

  const downstreamTemp = createTempWorkspace('atm-downstream-');
  try {
    const downstreamCwd = path.join(downstreamTemp, 'downstream');
    mkdirSync(path.join(downstreamCwd, '.atm'), { recursive: true });
    mkdirSync(path.join(downstreamCwd, 'src'), { recursive: true });
    writeFileSync(
      path.join(downstreamCwd, '.atm', 'config.json'),
      readFileSync(path.join(downstreamFixtureRoot, '.atm', 'config.json'))
    );
    writeFileSync(
      path.join(downstreamCwd, 'src', 'downstream-helper.js'),
      readFileSync(path.join(downstreamFixtureRoot, 'src', 'downstream-helper.js'))
    );
    mkdirSync(path.join(downstreamCwd, 'fixtures'), { recursive: true });
    writeFileSync(
      path.join(downstreamCwd, 'fixtures', 'atom-index.json'),
      readFileSync(path.join(downstreamFixtureRoot, 'fixtures', 'atom-index.json'))
    );
    writeFileSync(
      path.join(downstreamCwd, 'fixtures', 'demand-report.json'),
      readFileSync(path.join(downstreamFixtureRoot, 'fixtures', 'demand-report.json'))
    );

    // start --target-file --release-blocker --legacy-flow
    const startLegacy = await runAtmJsonPortable([
      'start', '--cwd', downstreamCwd,
      '--goal', 'extract leaf helper from downstream legacy',
      '--target-file', 'src/downstream-helper.js',
      '--release-blocker', 'processRequest',
      '--legacy-flow', '--json'
    ]);
    assert(startLegacy.exitCode === 0, 'start --target-file --legacy-flow must exit 0');
    assert(typeof startLegacy.parsed.evidence?.sessionId === 'string', 'start --legacy-flow must create sessionId');
    const storedPlan = startLegacy.parsed.evidence?.legacyRoutePlan
      ?? startLegacy.parsed.evidence?.session?.legacyRoutePlan;
    assert(storedPlan?.schemaId === 'atm.legacyRoutePlan', 'start --legacy-flow must produce LegacyRoutePlan');
    assert(Array.isArray(storedPlan?.trunkFunctions) && storedPlan.trunkFunctions.includes('processRequest'),
      'processRequest must be classified as trunk function');
    assert(Array.isArray(storedPlan?.safeFirstAtoms) && storedPlan.safeFirstAtoms.length > 0,
      'fixture must have at least one safe leaf atom');

    // next -- active session with legacyRoutePlan must return selectedSegment / blockedSegments
    const nextLegacy = await runAtmJsonPortable(['next', '--cwd', downstreamCwd, '--json']);
    assert(nextLegacy.exitCode === 0, 'next with active legacy session must exit 0');
    const nextAction = nextLegacy.parsed.evidence?.nextAction as Record<string, unknown> | undefined;
    assert(typeof nextAction?.selectedSegment === 'string',
      'next must return selectedSegment from LegacyRoutePlan');
    assert(Array.isArray(nextAction?.blockedSegments),
      'next must return blockedSegments from LegacyRoutePlan');
    assert((nextAction?.blockedSegments as string[]).includes('processRequest'),
      'blockedSegments must include trunk processRequest');
    assert(nextAction?.selectedSegment !== 'processRequest',
      'selectedSegment must not be the trunk function');

    // start --legacy-flow with config hotspot (no --target-file)
    const startConfigFlow = await runAtmJsonPortable([
      'start', '--cwd', downstreamCwd,
      '--goal', 'refactor first config hotspot via legacy flow',
      '--legacy-flow', '--json'
    ]);
    assert(startConfigFlow.exitCode === 0, 'start --legacy-flow with config hotspot must exit 0');
    const configFlowPlan = startConfigFlow.parsed.evidence?.legacyRoutePlan
      ?? startConfigFlow.parsed.evidence?.session?.legacyRoutePlan;
    assert(configFlowPlan?.schemaId === 'atm.legacyRoutePlan',
      'config-driven legacy-flow must produce LegacyRoutePlan');
    assert(Array.isArray(configFlowPlan?.trunkFunctions) && configFlowPlan.trunkFunctions.includes('processRequest'),
      'config release blocker must classify processRequest as trunk');

    // ── A. shadow mode: config defaultLegacyFlow=shadow must activate shadowMode ──────────────────
    assert(startConfigFlow.parsed.evidence?.shadowMode === true,
      'start --legacy-flow must activate shadowMode when config defaultLegacyFlow=shadow');
    assert(startConfigFlow.parsed.evidence?.effectiveLegacyFlow === 'shadow',
      'effectiveLegacyFlow must be "shadow" when config defaultLegacyFlow=shadow');

    // ── B. infect leaf: existingAtomIndexPath match must route normalizePayload → infect ──────────
    const normalizeSegment = (configFlowPlan?.segments as Array<Record<string, unknown>> | undefined)
      ?.find((s) => s['symbolName'] === 'normalizePayload');
    assert(normalizeSegment !== undefined, 'config-driven plan must contain normalizePayload segment');
    assert(normalizeSegment?.['recommendedBehavior'] === 'infect',
      'normalizePayload with existingAtomIndexPath match must route to infect');
    assert(normalizeSegment?.['existingAtomMatch'] === 'ATM-FIXTURE-NORMALIZE-0001',
      'normalizePayload existingAtomMatch must be populated from atom-index fixture');

    // ── C. split leaf: demandReportPath callerDemand > threshold must route applyTransform → split ─
    const transformSegment = (configFlowPlan?.segments as Array<Record<string, unknown>> | undefined)
      ?.find((s) => s['symbolName'] === 'applyTransform');
    assert(transformSegment !== undefined, 'config-driven plan must contain applyTransform segment');
    assert(transformSegment?.['recommendedBehavior'] === 'split',
      'applyTransform with callerDemand > threshold must route to split');

    // ── D. next command contains --legacy-target, --guidance-session, --dry-run ─────────────────────
    const nextConfigFlow = await runAtmJsonPortable(['next', '--cwd', downstreamCwd, '--json']);
    assert(nextConfigFlow.exitCode === 0, 'next after config-flow start must exit 0');
    const configNextAction = nextConfigFlow.parsed.evidence?.nextAction as Record<string, unknown> | undefined;
    assert(typeof configNextAction?.['command'] === 'string',
      'next after config-flow must return command string');
    const configNextCmd = String(configNextAction?.['command'] ?? '');
    assert(configNextCmd.includes('--legacy-target'),
      'next command must include --legacy-target');
    assert(configNextCmd.includes('--guidance-session'),
      'next command must include --guidance-session');
    assert(configNextCmd.includes('--dry-run'),
      'next command must include --dry-run');
    assert(!configNextCmd.includes('processRequest'),
      'next command --legacy-target must not point to trunk processRequest');
    assert(typeof configNextAction?.['legacyTarget'] === 'string',
      'next action must expose legacyTarget field');
    assert(typeof configNextAction?.['targetFile'] === 'string',
      'next action must expose targetFile field');
    assert(typeof configNextAction?.['selectedBehavior'] === 'string',
      'next action must expose selectedBehavior field');

    const guidedProposal = await runAtmJsonPortable([
      'upgrade', '--cwd', downstreamCwd,
      '--propose',
      '--behavior', `behavior.${String(configNextAction?.['selectedBehavior'])}`,
      '--legacy-target', String(configNextAction?.['legacyTarget']),
      '--guidance-session', String(nextConfigFlow.parsed.evidence?.guidanceSession?.sessionId),
      '--dry-run', '--json'
    ]);
    assert(guidedProposal.exitCode === 0,
      'guided legacy dry-run proposal command returned by next must execute successfully');
    assert(guidedProposal.parsed.evidence?.proposal?.schemaId === 'atm.guidedLegacyDryRunProposal',
      'guided legacy dry-run proposal must emit proposal evidence');
    assert(guidedProposal.parsed.evidence?.humanReviewRequired === true,
      'guided legacy dry-run proposal must require human review');
    assert(guidedProposal.parsed.evidence?.rollbackProofRequired === true,
      'guided legacy dry-run proposal must require rollback proof');
    assert(guidedProposal.parsed.evidence?.queued === true,
      'guided legacy dry-run proposal must be enqueued for human review');

    const reviewList = await runAtmJsonPortable(['review', 'list', '--cwd', downstreamCwd, '--json']);
    assert(reviewList.exitCode === 0,
      'review list must exit 0 after guided legacy dry-run proposal');
    assert((reviewList.parsed.evidence?.proposals as unknown[] | undefined)?.length === 1,
      'review list must include the guided legacy dry-run proposal');
    const reviewShow = await runAtmJsonPortable([
      'review', 'show', String(guidedProposal.parsed.evidence?.proposalId),
      '--cwd', downstreamCwd, '--json'
    ]);
    assert(reviewShow.exitCode === 0,
      'review show must load the guided legacy dry-run proposal');
    assert(reviewShow.parsed.evidence?.proposal?.proposalId === guidedProposal.parsed.evidence?.proposalId,
      'review show must return the guided legacy dry-run proposal');

    const nextAfterPending = await runAtmJsonPortable(['next', '--cwd', downstreamCwd, '--json']);
    assert(nextAfterPending.exitCode === 0,
      'next must exit 0 when matching guided legacy proposal is already pending');
    const pendingNextAction = nextAfterPending.parsed.evidence?.nextAction as Record<string, unknown> | undefined;
    const pendingNextCommand = String(pendingNextAction?.['command'] ?? '');
    assert(pendingNextCommand.includes('review show'),
      'next must route to review show when matching guided legacy proposal is already pending');
    assert(pendingNextCommand.includes(String(guidedProposal.parsed.evidence?.proposalId)),
      'next pending-review route must reference the queued proposalId');
    assert(pendingNextAction?.['proposalId'] === guidedProposal.parsed.evidence?.proposalId,
      'next pending-review route must expose proposalId');
    assert(pendingNextAction?.['proposalStatus'] === 'pending',
      'next pending-review route must expose proposalStatus=pending');
    assert(pendingNextAction?.['nextRouteState'] === 'proposal-pending-review',
      'next pending-review route must expose nextRouteState=proposal-pending-review');

    const approvedProposalId = 'guided-legacy-atomize-custom-approved';
    const approvedProposal = await runAtmJsonPortable([
      'upgrade', '--cwd', downstreamCwd,
      '--propose',
      '--behavior', `behavior.${String(configNextAction?.['selectedBehavior'])}`,
      '--legacy-target', String(configNextAction?.['legacyTarget']),
      '--guidance-session', String(nextConfigFlow.parsed.evidence?.guidanceSession?.sessionId),
      '--proposal-id', approvedProposalId,
      '--dry-run', '--json'
    ]);
    assert(approvedProposal.exitCode === 0,
      'custom guided legacy dry-run proposal must execute successfully');
    const reviewApprove = await runAtmJsonPortable([
      'review', 'approve', approvedProposalId,
      '--cwd', downstreamCwd,
      '--reason', 'validator fixture approval',
      '--by', 'guidance-validator',
      '--json'
    ]);
    assert(reviewApprove.exitCode === 0,
      'review approve must exit 0 for custom guided legacy proposal');
    assert(reviewApprove.parsed.evidence?.status === 'approved',
      'review approve must mark custom guided legacy proposal as approved');

    const nextAfterApproved = await runAtmJsonPortable(['next', '--cwd', downstreamCwd, '--json']);
    assert(nextAfterApproved.exitCode === 0,
      'next must exit 0 when matching guided legacy proposal is already approved');
    const approvedNextAction = nextAfterApproved.parsed.evidence?.nextAction as Record<string, unknown> | undefined;
    const approvedNextCommand = String(approvedNextAction?.['command'] ?? '');
    assert(approvedNextCommand.includes('review apply-ready'),
      'next must route to review apply-ready when a matching guided legacy proposal is already approved');
    assert(approvedNextCommand.includes(approvedProposalId),
      'next approved route must point to the approved custom proposalId');
    assert(!approvedNextCommand.includes('upgrade --propose'),
      'next approved route must not ask for another duplicate dry-run proposal');
    assert(approvedNextAction?.['proposalId'] === approvedProposalId,
      'next approved route must expose the approved custom proposalId');
    assert(approvedNextAction?.['proposalStatus'] === 'approved',
      'next approved route must expose proposalStatus=approved');
    assert(approvedNextAction?.['nextRouteState'] === 'proposal-approved',
      'next approved route must expose nextRouteState=proposal-approved');
    assert(!String(approvedNextAction?.['missingEvidence'] ?? '').includes('human review before apply'),
      'next approved route must stop requiring human review before apply');
    const applyReady = await runAtmJsonPortable([
      'review', 'apply-ready', approvedProposalId,
      '--cwd', downstreamCwd, '--json'
    ]);
    assert(applyReady.exitCode === 0,
      'review apply-ready must exit 0 for approved guided legacy proposal');
    assert(applyReady.parsed.evidence?.applyPacket?.proposalId === approvedProposalId,
      'review apply-ready must return the approved proposalId');
    assert(applyReady.parsed.evidence?.applyPacket?.targetSymbol != null,
      'review apply-ready must expose targetSymbol for the approved leaf');
    assert(Array.isArray(applyReady.parsed.evidence?.applyPacket?.mutationBoundary?.blocked),
      'review apply-ready must expose blocked mutation boundary guidance');

    const rolloutProofPath = path.join(downstreamCwd, '.atm', 'history', 'reports', 'rollback-ready-proof.fixture.json');
    writeFileSync(rolloutProofPath, `\uFEFF${JSON.stringify({
      rollbackReady: true,
      patchPath: '.atm/history/reports/rollback-ready.patch'
    }, null, 2)}`);
    const actualPatchEvidencePath = path.join(downstreamCwd, '.atm', 'history', 'reports', 'actual-patch-evidence.fixture.json');
    writeFileSync(actualPatchEvidencePath, `\uFEFF${JSON.stringify({
      generatedAt: '2026-01-02T00:00:00.000Z',
      proposalId: approvedProposalId,
      legacyTarget: String(configNextAction?.['legacyTarget']),
      patchFiles: ['src/downstream-helper.js'],
      smokeEvidence: [
        { name: 'smoke', logPath: '.atm/history/reports/smoke.log' }
      ],
      rollbackReadyProof: {
        proofPath: rolloutProofPath,
        patchPath: '.atm/history/reports/rollback-ready.patch'
      }
    }, null, 2)}`);

    const nextAfterRolloutEvidence = await runAtmJsonPortable(['next', '--cwd', downstreamCwd, '--json']);
    assert(nextAfterRolloutEvidence.exitCode === 0,
      'next must exit 0 when approved proposal also has actual patch evidence');
    const rolloutNextAction = nextAfterRolloutEvidence.parsed.evidence?.nextAction as Record<string, unknown> | undefined;
    const rolloutNextCommand = String(rolloutNextAction?.['command'] ?? '');
    assert(rolloutNextCommand.includes('review rollout-ready'),
      'next must route to review rollout-ready when actual patch evidence and rollback proof are present');
    assert(rolloutNextAction?.['nextRouteState'] === 'proposal-rollout-ready',
      'next must expose nextRouteState=proposal-rollout-ready when rollout evidence exists');
    const rolloutReady = await runAtmJsonPortable([
      'review', 'rollout-ready', approvedProposalId,
      '--cwd', downstreamCwd, '--json'
    ]);
    assert(rolloutReady.exitCode === 0,
      'review rollout-ready must exit 0 for approved proposals with actual patch evidence');
    assert(rolloutReady.parsed.evidence?.rolloutPacket?.proposalId === approvedProposalId,
      'review rollout-ready must return the approved proposalId');
    assert(rolloutReady.parsed.evidence?.rolloutPacket?.rolloutCloseout?.smokeEvidenceSatisfied === true,
      'review rollout-ready must confirm smoke evidence');
    assert(rolloutReady.parsed.evidence?.rolloutPacket?.rolloutCloseout?.rollbackReadySatisfied === true,
      'review rollout-ready must confirm rollback-ready proof');

    // ── E. blockedSegments still includes trunk functions ─────────────────────────────────────────
    assert(Array.isArray(configNextAction?.['blockedSegments']),
      'next action must include blockedSegments array');
    assert((configNextAction?.['blockedSegments'] as string[]).includes('processRequest'),
      'blockedSegments must include trunk processRequest');
  } finally {
    rmSync(downstreamTemp, { recursive: true, force: true });
  }


}
