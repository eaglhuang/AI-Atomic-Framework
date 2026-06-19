import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { inspectRuntimeAdapterReadiness } from '../packages/cli/src/commands/runtime-adapter-readiness.ts';

const validator = createValidator('guidance');
const { assert, requireFile, runAtmJsonPortable, ok, root } = validator;

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
  const help = await runAtmJsonPortable([commandName, '--help', '--json']);
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

const candidateRoute = decideGuidanceRoute({
  goal: 'rank the messiest Python pipeline scripts',
  orientation,
  evidence: {}
});
assert(candidateRoute.recommendedRoute === 'legacy-candidate-ranking', 'candidate ranking goal must route to legacy-candidate-ranking');
assert(candidateRoute.nextCommand.includes('candidates rank'), 'candidate ranking route must recommend candidates rank');
assert(candidateRoute.requiredEvidence.includes('source inventory report'), 'candidate ranking route must require source inventory evidence');

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

const goalAlignedPlan = await buildLegacyRoutePlan({
  sourceText: [
    'def kinship_pair_binding_supported(value):',
    '    return spouse_supports_pair_binding(value)',
    '',
    'def _required_rule_value(value):',
    '    return str(value).strip()',
    '',
    'def spouse_supports_pair_binding(value):',
    '    return bool(value)'
  ].join('\n'),
  targetFile: 'pipelines/sanguo-rag/relationship_type_refinement.py',
  releaseBlockerSymbols: ['kinship_pair_binding_supported'],
  callerDistribution: {
    _required_rule_value: 1,
    spouse_supports_pair_binding: 1
  }
});
const explicitSymbolRoute = decideGuidanceRoute({
  goal: 'guided atomize spouse_supports_pair_binding route selection',
  orientation,
  evidence: { legacyRoutePlan: goalAlignedPlan }
});
assert(explicitSymbolRoute.routeChoices[0]?.goalAlignment?.symbolName === 'spouse_supports_pair_binding',
  'explicit symbol goal must rank spouse_supports_pair_binding ahead of generic helper');
assert(explicitSymbolRoute.routeChoices[0]?.goalAlignment?.score === 100,
  'explicit symbol goal must expose goalAlignment score');
assert(String(explicitSymbolRoute.routeChoices[0]?.overrideReason ?? '').includes('matched the guidance goal'),
  'explicit symbol goal must expose overrideReason');
assert(explicitSymbolRoute.routeChoices[0]?.goalAlignment?.symbolName !== 'kinship_pair_binding_supported',
  'explicit symbol route must not select blocked trunk kinship_pair_binding_supported');

const touchedSymbolRoute = decideGuidanceRoute({
  goal: 'guided atomize route selection',
  orientation,
  evidence: {
    legacyRoutePlan: goalAlignedPlan,
    touchedSymbols: ['spouse_supports_pair_binding']
  }
});
assert(touchedSymbolRoute.routeChoices[0]?.goalAlignment?.symbolName === 'spouse_supports_pair_binding',
  'touched symbol evidence must rank touched semantic leaf ahead of generic helper');
assert(touchedSymbolRoute.routeChoices[0]?.goalAlignment?.score === 75,
  'touched symbol evidence must expose touched-symbol goalAlignment score');

const helperFallbackRoute = decideGuidanceRoute({
  goal: 'guided atomize route selection',
  orientation,
  evidence: { legacyRoutePlan: goalAlignedPlan }
});
assert(helperFallbackRoute.routeChoices[0]?.goalAlignment?.symbolName === '_required_rule_value',
  'generic helper must remain fallback when no goal-aligned or touched semantic leaf exists');
assert(String(helperFallbackRoute.routeChoices[0]?.overrideReason ?? '').includes('helper fallback'),
  'helper fallback route must explain why no semantic override was used');

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

const pythonHelperPlan = await buildLegacyRoutePlan({
  sourceText: [
    'def pipeline_entry(value):',
    '    normalized = normalize_payload(value)',
    '    return emit_payload(normalized)',
    '',
    'def normalize_payload(value):',
    '    return value.strip().lower()',
    '',
    'def emit_payload(value):',
    '    return value'
  ].join('\n'),
  targetFile: 'tests/guidance-fixtures/python-helper.py',
  releaseBlockerSymbols: ['pipeline_entry'],
  callerDistribution: { normalize_payload: 2, emit_payload: 1 }
});
assert(pythonHelperPlan.trunkFunctions.includes('pipeline_entry'), 'Python helper fixture must classify release blocker as trunk');
assert(pythonHelperPlan.safeFirstAtoms.includes('normalize_payload'), 'Python helper fixture must expose normalize_payload as safe leaf');
const emitPayloadSegment = pythonHelperPlan.segments.find((segment) => segment.symbolName === 'emit_payload');
assert(emitPayloadSegment?.role === 'adapter-boundary', 'Python emit_payload helper must remain adapter-boundary');

const javaHelperPlan = await buildLegacyRoutePlan({
  sourceText: [
    'public final class PipelineHelper {',
    '  public String pipelineEntry(String value) {',
    '    return normalizePayload(value);',
    '  }',
    '',
    '  private String normalizePayload(String value) {',
    '    return value.trim().toLowerCase();',
    '  }',
    '}'
  ].join('\n'),
  targetFile: 'tests/guidance-fixtures/PipelineHelper.java',
  releaseBlockerSymbols: ['pipelineEntry']
});
assert(javaHelperPlan.trunkFunctions.includes('pipelineEntry'), 'Java helper fixture must classify release blocker as trunk');
assert(javaHelperPlan.safeFirstAtoms.includes('normalizePayload'), 'Java helper fixture must expose normalizePayload as safe leaf');

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
  const orient = await runAtmJsonPortable(['orient', '--cwd', blankRepo, '--json'], root);
  assert(orient.exitCode === 0, 'orient must exit 0 for blank repo');
  assert(orient.parsed.evidence?.orientation?.adapterStatus?.status === 'missing', 'blank repo must report missing adapter');

  const start = await runAtmJsonPortable(['start', '--cwd', blankRepo, '--goal', 'Bootstrap unknown repo', '--json'], root);
  assert(start.exitCode === 0, 'start must exit 0 for blank repo');
  assert(start.parsed.evidence?.sessionId, 'start must create sessionId');
  assert(start.parsed.evidence?.routeDecision?.recommendedRoute === 'adapter-bootstrap', 'blank repo route must be adapter-bootstrap');
  assert(start.parsed.evidence?.guidancePacket?.nextCommand.includes('bootstrap'), 'guidance packet must recommend bootstrap');

  const next = await runAtmJsonPortable(['next', '--cwd', blankRepo, '--json'], root);
  assert(next.exitCode === 0, 'guidance-aware next must exit 0 with active session');
  assert(typeof next.parsed.evidence?.nextAction?.command === 'string', 'next must return nextAction.command');
  assert(Array.isArray(next.parsed.evidence?.nextAction?.allowedCommands), 'next must return allowedCommands');
  assert(Array.isArray(next.parsed.evidence?.nextAction?.blockedCommands), 'next must return blockedCommands');

  const explain = await runAtmJsonPortable(['explain', '--cwd', blankRepo, '--why', 'blocked', '--json'], root);
  assert(explain.exitCode === 0, 'explain blocked must exit 0 with active session');
  assert(explain.parsed.evidence?.sessionId === start.parsed.evidence?.sessionId, 'explain must use active session');

  const pythonOnlyRepo = path.join(tempRoot, 'python-only-repo');
  mkdirSync(path.join(pythonOnlyRepo, '.atm'), { recursive: true });
  mkdirSync(path.join(pythonOnlyRepo, 'pipelines'), { recursive: true });
  writeFileSync(path.join(pythonOnlyRepo, '.atm', 'config.json'), JSON.stringify({
    schemaVersion: '0.1.0',
    adapter: { mode: 'standalone' }
  }, null, 2));
  writeFileSync(path.join(pythonOnlyRepo, 'requirements.txt'), 'pytest\n', 'utf8');
  writeFileSync(path.join(pythonOnlyRepo, 'pipelines', 'legacy_pipeline.py'), [
    'def main(raw_value):',
    '    normalized = normalize_payload(raw_value)',
    '    return emit_payload(normalized)',
    '',
    'def normalize_payload(raw_value):',
    '    return raw_value.strip().lower()',
    '',
    'def emit_payload(value):',
    '    return value'
  ].join('\n'), 'utf8');
  const pythonOnlyOrientation = probeProject(pythonOnlyRepo);
  assert(pythonOnlyOrientation.detectedLanguages.includes('Python'), 'Python-only repo must detect Python');
  assert(!pythonOnlyOrientation.releaseBlockers.includes('package-json-missing'), 'Python-only repo must not treat missing package.json as release blocker');
  assert(pythonOnlyOrientation.releaseAdvisories?.includes('package-json-missing:advisory'), 'Python-only repo must downgrade package-json-missing to advisory');
  const pythonRuntimeReadiness = inspectRuntimeAdapterReadiness(pythonOnlyRepo);
  assert(pythonRuntimeReadiness.pythonOnlyHost === true, 'Python-only repo must report pythonOnlyHost=true');
  assert(pythonRuntimeReadiness.pythonLanguageAdapterAvailable === true, 'bundled @ai-atomic-framework/language-python adapter must be detected');
  assert(pythonRuntimeReadiness.needsRuntimeAdapterHint === false, 'Python-only repo must no longer require runtime adapter selection when language-python is bundled');
  assert(pythonRuntimeReadiness.atomBirthApplyDeferred === false, 'atom birth/apply must no longer be deferred for Python-only repos once language-python is bundled');
  const pythonOnlyRoute = decideGuidanceRoute({
    goal: 'rank the messiest Python pipeline scripts',
    orientation: pythonOnlyOrientation,
    evidence: {}
  });
  assert(pythonOnlyRoute.recommendedRoute === 'legacy-candidate-ranking', 'Python-only repo must allow candidate ranking route');
  assert(!pythonOnlyRoute.blockedBy.includes('package-json-missing'), 'Python-only candidate ranking must not be blocked by package-json-missing');
  const pythonLegacyStart = await runAtmJsonPortable([
    'start', '--cwd', pythonOnlyRepo,
    '--goal', 'extract helper from Python legacy pipeline',
    '--target-file', 'pipelines/legacy_pipeline.py',
    '--release-blocker', 'main',
    '--legacy-flow', '--json'
  ], root);
  assert(pythonLegacyStart.exitCode === 0, 'Python-only start --legacy-flow must exit 0');
  const pythonStoredPlan = pythonLegacyStart.parsed.evidence?.legacyRoutePlan
    ?? pythonLegacyStart.parsed.evidence?.session?.legacyRoutePlan;
  assert(pythonStoredPlan?.schemaId === 'atm.legacyRoutePlan', 'Python-only start --legacy-flow must produce LegacyRoutePlan');
  assert(Array.isArray(pythonStoredPlan?.trunkFunctions) && pythonStoredPlan.trunkFunctions.includes('main'),
    'Python-only legacy route plan must classify main as trunk');
  assert(Array.isArray(pythonStoredPlan?.safeFirstAtoms) && pythonStoredPlan.safeFirstAtoms.includes('normalize_payload'),
    'Python-only legacy route plan must expose normalize_payload as safe leaf');
  const pythonEmitSegment = (pythonStoredPlan?.segments as Array<Record<string, unknown>> | undefined)
    ?.find((segment) => segment['symbolName'] === 'emit_payload');
  assert(pythonEmitSegment?.['role'] === 'adapter-boundary',
    'Python-only legacy route plan must keep emit_payload as adapter-boundary');

  const javaOnlyRepo = path.join(tempRoot, 'java-only-repo');
  mkdirSync(path.join(javaOnlyRepo, '.atm'), { recursive: true });
  mkdirSync(path.join(javaOnlyRepo, 'src', 'main', 'java'), { recursive: true });
  writeFileSync(path.join(javaOnlyRepo, '.atm', 'config.json'), JSON.stringify({
    schemaVersion: '0.1.0',
    adapter: { mode: 'standalone' }
  }, null, 2));
  writeFileSync(path.join(javaOnlyRepo, 'pom.xml'), '<project></project>\n', 'utf8');
  writeFileSync(path.join(javaOnlyRepo, 'src', 'main', 'java', 'App.java'), 'class App {}\n', 'utf8');
  const javaOnlyOrientation = probeProject(javaOnlyRepo);
  assert(javaOnlyOrientation.detectedLanguages.includes('Java'), 'Java-only repo must detect Java');
  assert(!javaOnlyOrientation.releaseBlockers.includes('package-json-missing'), 'Java-only repo must not treat missing package.json as release blocker');
  assert(javaOnlyOrientation.releaseAdvisories?.includes('package-json-missing:advisory'), 'Java-only repo must downgrade package-json-missing to advisory');
  const javaRuntimeReadiness = inspectRuntimeAdapterReadiness(javaOnlyRepo);
  assert(javaRuntimeReadiness.languageOnlyHost === true, 'Java-only repo must report languageOnlyHost=true');
  assert(javaRuntimeReadiness.needsRuntimeAdapterHint === true, 'Java-only repo must surface missing language adapter as advisory hint');
  assert(javaRuntimeReadiness.missingLanguageAdapters.includes('Java'), 'Java-only repo must name Java as missing language adapter');
  assert(javaRuntimeReadiness.atomBirthApplyDeferred === true, 'Java-only repo must defer atom birth/apply until language adapter selection');

  const csharpOnlyRepo = path.join(tempRoot, 'csharp-only-repo');
  mkdirSync(path.join(csharpOnlyRepo, '.atm'), { recursive: true });
  writeFileSync(path.join(csharpOnlyRepo, '.atm', 'config.json'), JSON.stringify({
    schemaVersion: '0.1.0',
    adapter: { mode: 'standalone' }
  }, null, 2));
  writeFileSync(path.join(csharpOnlyRepo, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n', 'utf8');
  const csharpOnlyOrientation = probeProject(csharpOnlyRepo);
  assert(csharpOnlyOrientation.detectedLanguages.includes('C#'), 'C#-only repo must detect C#');
  assert(!csharpOnlyOrientation.releaseBlockers.includes('package-json-missing'), 'C#-only repo must not treat missing package.json as release blocker');
  const csharpRuntimeReadiness = inspectRuntimeAdapterReadiness(csharpOnlyRepo);
  assert(csharpRuntimeReadiness.languageOnlyHost === true, 'C#-only repo must report languageOnlyHost=true');
  assert(csharpRuntimeReadiness.needsRuntimeAdapterHint === true, 'C#-only repo must surface missing language adapter as advisory hint');
  assert(csharpRuntimeReadiness.missingLanguageAdapters.includes('C#'), 'C#-only repo must name C# as missing language adapter');
  assert(csharpRuntimeReadiness.atomBirthApplyDeferred === true, 'C#-only repo must defer atom birth/apply until language adapter selection');
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
assert(noSessionGate.issues.some((issue) => String(issue.details.nextStep ?? '').includes('guide --goal')),
  'mutation gate session failure must point back to guide --goal');
assert(noSessionGate.issues.some((issue) => issue.code === 'ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED'),
  'apply mutation gate must require rollback proof or rollback instructions');

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

ok('orientation, candidate ranking route, Python-only neutrality, reference legacy route plans, CLI session flow, mutation gate, proposal pairing, and host-local shadow+evidence wiring verified');
