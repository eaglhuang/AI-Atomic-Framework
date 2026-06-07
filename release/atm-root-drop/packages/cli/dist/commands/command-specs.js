import actorSpec from './command-specs/actor.spec.js';
import atomRefSpec from './command-specs/atom-ref.spec.js';
import atomCapsuleSpec from './command-specs/atom-capsule.spec.js';
import atomizeSpec from './command-specs/atomize.spec.js';
import baselineSpec from './command-specs/baseline.spec.js';
import batchSpec from './command-specs/batch.spec.js';
import bootstrapSpec from './command-specs/bootstrap.spec.js';
import budgetSpec from './command-specs/budget.spec.js';
import cacheSpec from './command-specs/cache.spec.js';
import candidatesSpec from './command-specs/candidates.spec.js';
import createSpec from './command-specs/create.spec.js';
import atmChartSpec from './command-specs/atm-chart.spec.js';
import createMapSpec from './command-specs/create-map.spec.js';
import daemonSpec from './command-specs/daemon.spec.js';
import doctorSpec from './command-specs/doctor.spec.js';
import doSpec from './command-specs/do.spec.js';
import experienceSpec from './command-specs/experience.spec.js';
import healthReportSpec from './command-specs/health-report.spec.js';
import identitySpec from './command-specs/identity.spec.js';
import orientSpec from './command-specs/orient.spec.js';
import mapCapsuleSpec from './command-specs/map-capsule.spec.js';
import policeSpec from './command-specs/police.spec.js';
import quickfixSpec from './command-specs/quickfix.spec.js';
import rescueSpec from './command-specs/rescue.spec.js';
import startSpec from './command-specs/start.spec.js';
import explainSpec from './command-specs/explain.spec.js';
import evidenceSpec from './command-specs/evidence.spec.js';
import frameworkModeSpec from './command-specs/framework-mode.spec.js';
import guardSpec from './command-specs/guard.spec.js';
import gitSpec from './command-specs/git.spec.js';
import gitHooksSpec from './command-specs/git-hooks.spec.js';
import guideSpec from './command-specs/guide.spec.js';
import handoffSpec from './command-specs/handoff.spec.js';
import hookSpec from './command-specs/hook.spec.js';
import initSpec from './command-specs/init.spec.js';
import internalReleaseSpec from './command-specs/internal-release.spec.js';
import integrationSpec from './command-specs/integration.spec.js';
import lockSpec from './command-specs/lock.spec.js';
import migrateSpec from './command-specs/migrate.spec.js';
import nextSpec from './command-specs/next.spec.js';
import selfHostAlphaSpec from './command-specs/self-host-alpha.spec.js';
import specSpec from './command-specs/spec.spec.js';
import statusSpec from './command-specs/status.spec.js';
import tasksSpec from './command-specs/tasks.spec.js';
import upgradeSpec from './command-specs/upgrade.spec.js';
import testSpec from './command-specs/test.spec.js';
import telemetrySpec from './command-specs/telemetry.spec.js';
import teamSpec from './command-specs/team.spec.js';
import validateSpec from './command-specs/validate.spec.js';
import welcomeSpec from './command-specs/welcome.spec.js';
import verifySpec from './command-specs/verify.spec.js';
import registrySpec from './command-specs/registry.spec.js';
import registryDiffSpec from './command-specs/registry-diff.spec.js';
import replacementLaneSpec from './command-specs/replacement-lane.spec.js';
import rollbackSpec from './command-specs/rollback.spec.js';
import reviewSpec from './command-specs/review.spec.js';
import agentPackSpec from './command-specs/agent-pack.spec.js';
import reviewAdvisorySpec from './command-specs/review-advisory.spec.js';
import taskflowSpec from './command-specs/taskflow.spec.js';
import brokerSpec from './command-specs/broker.spec.js';
function withVisibility(spec, visibility = 'public') {
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
    identity: identitySpec,
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
    team: teamSpec,
    upgrade: upgradeSpec,
    validate: validateSpec,
    welcome: welcomeSpec,
    verify: verifySpec,
    taskflow: withVisibility(taskflowSpec, 'internal'),
    broker: brokerSpec,
});
export function getCommandSpec(commandName) {
    return commandName in commandSpecs
        ? commandSpecs[commandName]
        : null;
}
export function listCommandSpecs(options = {}) {
    return Object.values(commandSpecs).filter((spec) => options.includeInternal || spec.visibility !== 'internal');
}
