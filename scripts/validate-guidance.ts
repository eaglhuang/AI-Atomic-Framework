import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BehaviorRegistry } from '../packages/plugin-sdk/src/behavior-registry.ts';
import { createTempWorkspace } from './temp-root.ts';
import { createValidator } from './lib/validator-harness.ts';
import {
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
  'packages/core/src/guidance/mutation-gate.ts',
  'packages/core/src/guidance/session-store.ts',
  'packages/cli/src/commands/orient.ts',
  'packages/cli/src/commands/start.ts',
  'packages/cli/src/commands/explain.ts'
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

const ciUnguidedGate = evaluateMutationGate({
  action: 'behavior.split',
  profile: 'ci',
  unguided: true,
  unguidedReason: 'fixture'
});
assert(ciUnguidedGate.allowed === false, 'unguided mutation must be forbidden in CI');
assert(ciUnguidedGate.issues.some((issue) => issue.code === 'ATM_GUIDANCE_UNGUIDED_FORBIDDEN'), 'unguided CI gate must report forbidden code');

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

ok('orientation, route decisions, CLI session flow, and mutation gate verified');
