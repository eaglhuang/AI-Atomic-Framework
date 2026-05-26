import { defineCommandSpec } from './shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption
} from './command-specs/_common.ts';

import actorSpec from './command-specs/actor.spec.ts';
import atomRefSpec from './command-specs/atom-ref.spec.ts';
import atomCapsuleSpec from './command-specs/atom-capsule.spec.ts';
import atomizeSpec from './command-specs/atomize.spec.ts';
import baselineSpec from './command-specs/baseline.spec.ts';
import batchSpec from './command-specs/batch.spec.ts';
import bootstrapSpec from './command-specs/bootstrap.spec.ts';
import budgetSpec from './command-specs/budget.spec.ts';
import cacheSpec from './command-specs/cache.spec.ts';
import candidatesSpec from './command-specs/candidates.spec.ts';
import createSpec from './command-specs/create.spec.ts';
import atmChartSpec from './command-specs/atm-chart.spec.ts';
import createMapSpec from './command-specs/create-map.spec.ts';
import daemonSpec from './command-specs/daemon.spec.ts';
import doctorSpec from './command-specs/doctor.spec.ts';
import doSpec from './command-specs/do.spec.ts';
import experienceSpec from './command-specs/experience.spec.ts';
import healthReportSpec from './command-specs/health-report.spec.ts';
import orientSpec from './command-specs/orient.spec.ts';
import mapCapsuleSpec from './command-specs/map-capsule.spec.ts';
import policeSpec from './command-specs/police.spec.ts';
import quickfixSpec from './command-specs/quickfix.spec.ts';
import rescueSpec from './command-specs/rescue.spec.ts';
import startSpec from './command-specs/start.spec.ts';
import explainSpec from './command-specs/explain.spec.ts';
import evidenceSpec from './command-specs/evidence.spec.ts';
import frameworkModeSpec from './command-specs/framework-mode.spec.ts';
import guardSpec from './command-specs/guard.spec.ts';
import gitSpec from './command-specs/git.spec.ts';
import gitHooksSpec from './command-specs/git-hooks.spec.ts';
import guideSpec from './command-specs/guide.spec.ts';
import handoffSpec from './command-specs/handoff.spec.ts';
import hookSpec from './command-specs/hook.spec.ts';
import initSpec from './command-specs/init.spec.ts';
import internalReleaseSpec from './command-specs/internal-release.spec.ts';
import integrationSpec from './command-specs/integration.spec.ts';
import lockSpec from './command-specs/lock.spec.ts';
import migrateSpec from './command-specs/migrate.spec.ts';
import nextSpec from './command-specs/next.spec.ts';
import selfHostAlphaSpec from './command-specs/self-host-alpha.spec.ts';
import specSpec from './command-specs/spec.spec.ts';
import statusSpec from './command-specs/status.spec.ts';
import tasksSpec from './command-specs/tasks.spec.ts';
import upgradeSpec from './command-specs/upgrade.spec.ts';
import testSpec from './command-specs/test.spec.ts';
import telemetrySpec from './command-specs/telemetry.spec.ts';
import validateSpec from './command-specs/validate.spec.ts';
import welcomeSpec from './command-specs/welcome.spec.ts';
import verifySpec from './command-specs/verify.spec.ts';
import registrySpec from './command-specs/registry.spec.ts';
import registryDiffSpec from './command-specs/registry-diff.spec.ts';
import replacementLaneSpec from './command-specs/replacement-lane.spec.ts';
import rollbackSpec from './command-specs/rollback.spec.ts';
import reviewSpec from './command-specs/review.spec.ts';
import agentPackSpec from './command-specs/agent-pack.spec.ts';
import reviewAdvisorySpec from './command-specs/review-advisory.spec.ts';

function withVisibility(spec: any, visibility: 'public' | 'internal' = 'public') {
  return Object.freeze({
    ...spec,
    visibility
  });
}

export const commandSpecs = Object.freeze({
  actor: actorSpec,
  'agent-pack': agentPackSpec,
  'atom-capsule': withVisibility(atomCapsuleSpec, 'internal'),
  'atom-ref': atomRefSpec,
  atomize: atomizeSpec,
  'atm-chart': atmChartSpec,
  baseline: baselineSpec,
  batch: batchSpec,
  bootstrap: bootstrapSpec,
  budget: budgetSpec,
  cache: cacheSpec,
  candidates: candidatesSpec,
  create: createSpec,
  'create-map': createMapSpec,
  daemon: withVisibility(daemonSpec, 'internal'),
  doctor: doctorSpec,
  do: withVisibility(doSpec, 'internal'),
  experience: experienceSpec,
  explain: explainSpec,
  evidence: evidenceSpec,
  'framework-mode': frameworkModeSpec,
  git: gitSpec,
  'git-hooks': gitHooksSpec,
  guide: guideSpec,
  guard: guardSpec,
  handoff: handoffSpec,
  'health-report': withVisibility(healthReportSpec, 'internal'),
  hook: hookSpec,
  init: initSpec,
  'internal-release': internalReleaseSpec,
  integration: integrationSpec,
  lock: lockSpec,
  'map-capsule': withVisibility(mapCapsuleSpec, 'internal'),
  migrate: migrateSpec,
  next: nextSpec,
  orient: orientSpec,
  police: policeSpec,
  quickfix: quickfixSpec,
  rescue: withVisibility(rescueSpec, 'internal'),
  registry: registrySpec,
  'registry-diff': registryDiffSpec,
  'replacement-lane': replacementLaneSpec,
  review: reviewSpec,
  'review-advisory': reviewAdvisorySpec,
  rollback: rollbackSpec,
  'self-host-alpha': selfHostAlphaSpec,
  spec: specSpec,
  start: startSpec,
  status: statusSpec,
  tasks: tasksSpec,
  test: testSpec,
  telemetry: telemetrySpec,
  upgrade: upgradeSpec,
  validate: validateSpec,
  welcome: welcomeSpec,
  verify: verifySpec,
});

export function getCommandSpec(commandName: string) {
  return commandName in commandSpecs
    ? commandSpecs[commandName as keyof typeof commandSpecs]
    : null;
}

export function listCommandSpecs(options: { includeInternal?: boolean } = {}) {
  return Object.values(commandSpecs).filter((spec: any) => options.includeInternal || spec.visibility !== 'internal');
}

