import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { atomizeBehavior } from '../packages/plugin-behavior-pack/src/atomize.ts';
import { infectBehavior } from '../packages/plugin-behavior-pack/src/infect.ts';
import { BehaviorRegistry } from '../packages/plugin-sdk/src/behavior-registry.ts';
import { validateDecisionBehaviorPair } from '../packages/core/src/upgrade/decomposition-decision.ts';
import { createTempWorkspace } from './temp-root.ts';
import { createValidator } from './lib/validator-harness.ts';
import {
  buildLegacyRoutePlan,
  decideGuidanceRoute,
  evaluateMutationGate,
  probeProject
} from '../packages/core/src/guidance/index.ts';

const validator = createValidator('guidance');
const { assert, requireFile, runAtmJson, ok, root } = validator;

for (const relativePath of [
  'packages/core/src/guidance/index.ts',
  'packages/core/src/guidance/project-probe.ts',
  'packages/core/src/guidance/route-engine.ts',
  'packages/core/src/guidance/legacy-route-plan.ts',
  'packages/core/src/guidance/mutation-gate.ts',
  'packages/core/src/guidance/session-store.ts',
  'packages/cli/src/commands/orient.ts',
  'packages/cli/src/commands/start.ts',
  'packages/cli/src/commands/explain.ts',
  'tests/guidance-fixtures/reference-legacy-dom-builder.js'
]) {
  requireFile(relativePath, `missing guidance dependency: ${relativePath}`);
}

for (const commandName of ['orient', 'start', 'next', 'explain']) {
  const help = runAtmJson([commandName, '--help', '--json']);
  assert(help.exitCode === 0, `${commandName} --help must exit 0`);
  assert(help.parsed.ok === true, `${commandName} --help must report ok=true`);
  assert(help.parsed.evidence?.usage?.command === commandName, `${commandName} --help must report usage.command`);
}

const orientation = probeProject(root);
assert(orientation.schemaId === 'atm.projectOrientationReport', 'probeProject must emit ProjectOrientationReport');
assert(orientation.repositoryRoot === root, 'probeProject must preserve repository root');
assert(Array.isArray(orientation.unknowns), 'orientation unknowns must be an array');

const infectRoute = decideGuidanceRoute({
  goal: 'reuse an existing atom in legacy code',
  orientation,
  evidence: { existingAtomMatches: ['ATM-CORE-0001'] }
});
assert(infectRoute.recommendedRoute === 'infect', 'existing atom match must route to infect');

const splitRoute = decideGuidanceRoute({
  goal: 'split a high demand helper',
  orientation,
  evidence: { demandPoliceFindings: ['demand-threshold-exceeded'] }
});
assert(splitRoute.recommendedRoute === 'split', 'demand finding must route to split');
assert(splitRoute.nextCommand.includes('behavior.split'), 'split route must recommend split proposal command');

const referenceFixturePath = path.join(root, 'tests/guidance-fixtures/reference-legacy-dom-builder.js');
const referenceSource = readFileSync(referenceFixturePath, 'utf8');
const referencePlan = await buildLegacyRoutePlan({
  sourceText: referenceSource,
  targetFile: 'tests/guidance-fixtures/reference-legacy-dom-builder.js',
  releaseBlockerSymbols: ['processElement'],
  existingAtomMatches: [{ symbolName: 'applyTypographyScale', atomId: 'ATM-CORE-TYPOGRAPHY-0001' }],
  callerDistribution: {
    parseColorToken: 2,
    applyTypographyScale: 2,
    parseFragmentDescriptor: 8,
    deriveTabSemantics: 2
  },
  demandThreshold: 6,
  fanOutThreshold: 5
});
assert(referencePlan.schemaId === 'atm.legacyRoutePlan', 'reference fixture must produce LegacyRoutePlan');
const processElementSegment = referencePlan.segments.find((segment) => segment.symbolName === 'processElement');
assert(processElementSegment?.role === 'trunk', 'processElement must be classified as trunk');
assert(processElementSegment?.riskLevel === 'high', 'processElement trunk must be high risk');
assert(referencePlan.releaseBlockers.includes('processElement'), 'processElement must be recorded as release blocker');
assert(referencePlan.noTouchZones.includes('tests/guidance-fixtures/reference-legacy-dom-builder.js#processElement'), 'trunk release blocker must become no-touch zone');

for (const helperName of ['parseColorToken', 'applyTypographyScale', 'parseFragmentDescriptor', 'deriveTabSemantics']) {
  assert(referencePlan.safeFirstAtoms.includes(helperName), `safeFirstAtoms must include ${helperName}`);
}
const colorSegment = referencePlan.segments.find((segment) => segment.symbolName === 'parseColorToken');
assert(colorSegment?.recommendedBehavior === 'atomize', 'new low-coupling color helper must route to atomize');
const typographySegment = referencePlan.segments.find((segment) => segment.symbolName === 'applyTypographyScale');
assert(typographySegment?.existingAtomMatch === 'ATM-CORE-TYPOGRAPHY-0001', 'existing atom match must be attached to typography helper');
assert(typographySegment?.recommendedBehavior === 'infect', 'existing atom match must route to infect, not duplicate atomize');
const fragmentSegment = referencePlan.segments.find((segment) => segment.symbolName === 'parseFragmentDescriptor');
assert(fragmentSegment?.recommendedBehavior === 'split', 'demand threshold helper must route to split proposal');

const referenceRoute = decideGuidanceRoute({
  goal: 'refactor neutral reference legacy builder',
  orientation,
  evidence: { legacyRoutePlan: referencePlan }
});
assert(referenceRoute.nextCommand.includes('--dry-run'), 'legacy route next command must be a dry-run proposal');
assert(!referenceRoute.nextCommand.includes('processElement'), 'legacy route must not recommend direct processElement mutation');

const newHelperPlan = await buildLegacyRoutePlan({
  sourceText: 'export function normalizeColorName(value) { return String(value || "").trim().toLowerCase(); }',
  targetFile: 'tests/guidance-fixtures/new-helper.js',
  callerDistribution: { normalizeColorName: 1 }
});
const newHelperRoute = decideGuidanceRoute({
  goal: 'extract a new low-coupling helper from legacy code',
  orientation,
  evidence: { legacyRoutePlan: newHelperPlan }
});
assert(newHelperRoute.recommendedRoute === 'atomize', 'new helper fixture must route to atomize');
assert(newHelperRoute.nextCommand.includes('behavior.atomize'), 'new helper route must recommend atomize dry-run proposal');

const demandPlan = await buildLegacyRoutePlan({
  sourceText: 'export function normalizeFragmentDemand(value) { return String(value || "").trim(); }',
  targetFile: 'tests/guidance-fixtures/demand-helper.js',
  callerDistribution: { normalizeFragmentDemand: 9 },
  demandThreshold: 6
});
const demandRoute = decideGuidanceRoute({
  goal: 'split a high demand helper from legacy code',
  orientation,
  evidence: { legacyRoutePlan: demandPlan }
});
assert(demandRoute.recommendedRoute === 'split', 'demand fixture must route to split');
assert(demandRoute.nextCommand.includes('behavior.split'), 'demand fixture must recommend split dry-run proposal');

const tempRoot = createTempWorkspace('atm-guidance-');
try {
  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });
  const orient = runAtmJson(['orient', '--cwd', blankRepo, '--json'], root);
  assert(orient.exitCode === 0, 'orient must exit 0 for blank repo');
  assert(orient.parsed.evidence?.orientation?.adapterStatus?.status === 'missing', 'blank repo must report missing adapter');

  const start = runAtmJson(['start', '--cwd', blankRepo, '--goal', 'Bootstrap unknown repo', '--json'], root);
  assert(start.exitCode === 0, 'start must exit 0 for blank repo');
  assert(start.parsed.evidence?.sessionId, 'start must create sessionId');
  assert(start.parsed.evidence?.routeDecision?.recommendedRoute === 'adapter-bootstrap', 'blank repo route must be adapter-bootstrap');
  assert(start.parsed.evidence?.guidancePacket?.nextCommand.includes('bootstrap'), 'guidance packet must recommend bootstrap');

  const next = runAtmJson(['next', '--cwd', blankRepo, '--json'], root);
  assert(next.exitCode === 0, 'guidance-aware next must exit 0 with active session');
  assert(typeof next.parsed.evidence?.nextAction?.command === 'string', 'next must return nextAction.command');
  assert(Array.isArray(next.parsed.evidence?.nextAction?.allowedCommands), 'next must return allowedCommands');
  assert(Array.isArray(next.parsed.evidence?.nextAction?.blockedCommands), 'next must return blockedCommands');

  const explain = runAtmJson(['explain', '--cwd', blankRepo, '--why', 'blocked', '--json'], root);
  assert(explain.exitCode === 0, 'explain blocked must exit 0 with active session');
  assert(explain.parsed.evidence?.sessionId === start.parsed.evidence?.sessionId, 'explain must use active session');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

const noSessionGate = evaluateMutationGate({
  action: 'behavior.atomize',
  isLegacyTarget: true,
  hasLegacyRoutePlan: false,
  hasDryRunProposal: false,
  applyRequested: true
});
assert(noSessionGate.allowed === false, 'mutation gate must block atomize without session');
assert(noSessionGate.issues.some((issue) => issue.code === 'ATM_GUIDANCE_SESSION_REQUIRED'), 'mutation gate must report session required');

const trunkGate = evaluateMutationGate({
  action: 'behavior.atomize',
  activeSession: { sessionId: 'fixture' } as any,
  hasLegacyRoutePlan: true,
  hasDryRunProposal: true,
  targetSegmentRole: 'trunk'
});
assert(trunkGate.allowed === false, 'mutation gate must hard fail direct trunk mutation');
assert(trunkGate.issues.some((issue) => issue.code === 'ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED'), 'trunk gate must report trunk mutation blocked');

const devUnguidedGate = evaluateMutationGate({
  action: 'behavior.split',
  profile: 'dev',
  unguided: true,
  unguidedReason: 'reference acceptance fixture'
});
assert(devUnguidedGate.allowed === true, 'unguided mutation with reason must be advisory in dev');
assert(devUnguidedGate.advisory === true, 'dev unguided gate must be advisory');
assert(devUnguidedGate.auditRequired === true, 'dev unguided gate must require audit');

const ciUnguidedGate = evaluateMutationGate({
  action: 'behavior.split',
  profile: 'ci',
  unguided: true,
  unguidedReason: 'fixture'
});
assert(ciUnguidedGate.allowed === false, 'unguided mutation must be forbidden in CI');
assert(ciUnguidedGate.issues.some((issue) => issue.code === 'ATM_GUIDANCE_UNGUIDED_FORBIDDEN'), 'unguided CI gate must report forbidden code');

const releaseUnguidedGate = evaluateMutationGate({
  action: 'behavior.split',
  profile: 'release',
  unguided: true,
  unguidedReason: 'fixture'
});
assert(releaseUnguidedGate.allowed === false, 'unguided mutation must be forbidden in release');

const behaviorRegistry = new BehaviorRegistry();
behaviorRegistry.register({
  behaviorId: 'mock-guided-atomize',
  actionCategories: ['behavior.atomize'],
  execute() {
    return { ok: true, issues: [], evidence: [] };
  }
});
const guarded = await behaviorRegistry.executeGuarded({ repositoryRoot: root }, {
  entryType: 'atom',
  atomId: 'ATM-CORE-0001',
  action: 'behavior.atomize',
  requestedBy: 'guidance-validator',
  payload: {
    requireGuidanceGate: true,
    isLegacyTarget: true,
    applyRequested: true
  }
});
assert(guarded.ok === false, 'BehaviorRegistry must block guided mutation without session/evidence');
assert(guarded.issues.includes('ATM_GUIDANCE_SESSION_REQUIRED'), 'BehaviorRegistry must surface guidance issue codes');

const atomizeProposal = await atomizeBehavior.execute({ repositoryRoot: root }, {
  entryType: 'atom',
  atomId: 'ATM-CORE-0001',
  action: 'behavior.atomize',
  requestedBy: 'guidance-validator',
  payload: {}
});
assert(atomizeProposal.ok === true, 'atomize behavior must emit proposal envelope');
const atomizeEnvelope = atomizeProposal.evidence[0]?.details?.proposalEnvelope as Record<string, unknown> | undefined;
assert(atomizeEnvelope?.behaviorId === 'behavior.atomize', 'atomize proposal envelope must preserve behaviorId');
assert(atomizeEnvelope?.patchMode === 'dry-run', 'atomize proposal must stay dry-run');

const infectProposal = await infectBehavior.execute({ repositoryRoot: root }, {
  entryType: 'atom',
  atomId: 'ATM-CORE-0001',
  action: 'behavior.infect',
  requestedBy: 'guidance-validator',
  payload: {}
});
assert(infectProposal.ok === true, 'infect behavior must emit proposal envelope');
const infectEnvelope = infectProposal.evidence[0]?.details?.proposalEnvelope as Record<string, unknown> | undefined;
assert(infectEnvelope?.behaviorId === 'behavior.infect', 'infect proposal envelope must preserve behaviorId');
assert(infectEnvelope?.patchMode === 'dry-run', 'infect proposal must stay dry-run');

let mismatchThrew = false;
try {
  validateDecisionBehaviorPair({ behaviorId: 'behavior.atomize', decompositionDecision: 'infect' });
} catch {
  mismatchThrew = true;
}
assert(mismatchThrew, 'behaviorId/decompositionDecision mismatch must hard fail');

ok('orientation, reference legacy route plans, CLI session flow, mutation gate, and proposal pairing verified');
