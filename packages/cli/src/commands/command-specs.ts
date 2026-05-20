import { defineCommandSpec } from './shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption
} from './command-specs/_common.ts';

import actorSpec from './command-specs/actor.spec.ts';
import bootstrapSpec from './command-specs/bootstrap.spec.ts';
import budgetSpec from './command-specs/budget.spec.ts';
import candidatesSpec from './command-specs/candidates.spec.ts';
import createSpec from './command-specs/create.spec.ts';
import atmChartSpec from './command-specs/atm-chart.spec.ts';
import createMapSpec from './command-specs/create-map.spec.ts';
import doctorSpec from './command-specs/doctor.spec.ts';
import experienceSpec from './command-specs/experience.spec.ts';
import orientSpec from './command-specs/orient.spec.ts';
import policeSpec from './command-specs/police.spec.ts';
import startSpec from './command-specs/start.spec.ts';
import explainSpec from './command-specs/explain.spec.ts';
import evidenceSpec from './command-specs/evidence.spec.ts';
import guardSpec from './command-specs/guard.spec.ts';
import gitSpec from './command-specs/git.spec.ts';
import guideSpec from './command-specs/guide.spec.ts';
import handoffSpec from './command-specs/handoff.spec.ts';
import initSpec from './command-specs/init.spec.ts';
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
import registryDiffSpec from './command-specs/registry-diff.spec.ts';
import replacementLaneSpec from './command-specs/replacement-lane.spec.ts';
import rollbackSpec from './command-specs/rollback.spec.ts';
import reviewSpec from './command-specs/review.spec.ts';
import agentPackSpec from './command-specs/agent-pack.spec.ts';
import reviewAdvisorySpec from './command-specs/review-advisory.spec.ts';

export const commandSpecs = Object.freeze({
  actor: actorSpec,
  bootstrap: bootstrapSpec,
  budget: budgetSpec,
  candidates: candidatesSpec,
  create: createSpec,
  'atm-chart': atmChartSpec,
  'create-map': createMapSpec,
  doctor: doctorSpec,
  experience: experienceSpec,
  orient: orientSpec,
  police: policeSpec,
  start: startSpec,
  explain: explainSpec,
  evidence: evidenceSpec,
  guard: guardSpec,
  git: gitSpec,
  guide: guideSpec,
  handoff: handoffSpec,
  init: initSpec,
  integration: integrationSpec,
  lock: lockSpec,
  migrate: migrateSpec,
  next: nextSpec,
  'self-host-alpha': selfHostAlphaSpec,
  spec: specSpec,
  status: statusSpec,
  tasks: tasksSpec,
  upgrade: upgradeSpec,
  test: testSpec,
  telemetry: telemetrySpec,
  validate: validateSpec,
  welcome: welcomeSpec,
  verify: verifySpec,
  'registry-diff': registryDiffSpec,
  'replacement-lane': replacementLaneSpec,
  rollback: rollbackSpec,
  review: reviewSpec,
  'agent-pack': agentPackSpec,
  'review-advisory': reviewAdvisorySpec,
});

export function getCommandSpec(commandName: string) {
  return commandName in commandSpecs
    ? commandSpecs[commandName as keyof typeof commandSpecs]
    : null;
}

export function listCommandSpecs() {
  return Object.values(commandSpecs);
}
