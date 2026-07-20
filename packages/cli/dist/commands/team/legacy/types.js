export const teamPermissionCatalog = [
    { id: 'task.lifecycle', mode: 'exclusive', hardGate: true },
    { id: 'git.write', mode: 'exclusive', hardGate: true },
    { id: 'file.read', mode: 'shareable', scopeRequired: true, hardGate: true },
    { id: 'file.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'web.query', mode: 'exclusive', hardGate: true },
    { id: 'web.download', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'exec.validator', mode: 'shareable', scopeRequired: true, hardGate: true },
    { id: 'exec.mutating', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'sandbox.write', mode: 'exclusive', hardGate: true },
    { id: 'pipeline.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'database.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'ci.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'evidence.write', mode: 'exclusive', hardGate: true },
    { id: 'knowledge.query', mode: 'shareable', hardGate: true },
    { id: 'knowledge.index.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
    { id: 'review.signature.write', mode: 'exclusive', hardGate: true },
    { id: 'handoff.read', mode: 'shareable', scopeRequired: true, hardGate: true },
    { id: 'handoff.materialize', mode: 'exclusive', scopeRequired: true, hardGate: true }
];
export const coordinatorExclusivePermissions = ['task.lifecycle', 'git.write', 'evidence.write'];
export const readOnlyTeamRoles = new Set([
    'atomizationPlanner',
    'scopeGuardian',
    'reader',
    'evidenceCollector',
    'validator',
    'lieutenant',
    'reviewAgent',
    'knowledgeScout'
]);
export const writeTeamPermissions = new Set([
    'task.lifecycle',
    'git.write',
    'file.write',
    'evidence.write',
    'review.signature.write',
    'web.query',
    'web.download',
    'knowledge.index.write',
    'exec.mutating',
    'sandbox.write',
    'pipeline.write',
    'database.write',
    'ci.write'
]);
export const atomizationRiskHotFiles = new Set([
    'tasks.ts',
    'next.ts',
    'evidence.ts',
    'hook.ts'
]);
export const atomizationPlanningThreshold = 3;
export const TEAM_ATOM_BOUNDARIES = {
    'team.cli-entry': {
        anchor: 'packages/cli/src/commands/team.ts#runTeam',
        capability: 'Team CLI entry router for plan, start, status, and validate actions.',
        downstreamTasks: ['TASK-TEAM-0001']
    },
    'team.recipe-permission-model': {
        anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
        capability: 'Recipe catalog validation and scoped permission lease planning.',
        downstreamTasks: ['TASK-TEAM-0001']
    },
    'team.plan-crew-briefing-contract': {
        anchor: 'packages/cli/src/commands/team.ts#buildMinimalTaskCrewBriefingContract',
        capability: 'Minimal crew briefing contract with required roles, stop conditions, and parallel advisory.',
        downstreamTasks: ['TASK-TEAM-0002']
    },
    'team.plan-atomization-planner': {
        anchor: 'packages/cli/src/commands/team.ts#buildAtomizationChecklist',
        capability: 'Atomization planner advisory checklist for scope shape and split recommendations.',
        downstreamTasks: ['TASK-TEAM-0003']
    },
    'team.plan-task-0009-preflight': {
        anchor: 'docs/governance/team-agents/task-0009-preflight-contract.md',
        capability: 'TASK-TEAM-0009 preflight/referee contract covering dependency map, acceptance checklist, and mailbox materialization corrective dispatch rules.',
        downstreamTasks: ['TASK-TEAM-0009']
    },
    'team.plan-broker-lane': {
        anchor: 'packages/cli/src/commands/team.ts#planTeamBrokerLane',
        capability: 'Broker lane evaluation and steward/composer routing for team plan/start.',
        downstreamTasks: ['TASK-TEAM-0001', 'TASK-CID-0021']
    },
    'team.start-claim-gate-parity': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamClaimAdmissionFindings',
        capability: 'Team plan/start claim admission parity against normal task dependency gates.',
        downstreamTasks: ['TASK-TEAM-0029']
    },
    'team.captain-decision': {
        anchor: 'packages/cli/src/commands/team.ts#buildCaptainDecision',
        capability: 'Captain decision dry-run output for team sizing, required roles, confidence, and stop conditions.',
        downstreamTasks: ['TASK-TEAM-0007']
    },
    'team.implementer-selector': {
        anchor: 'packages/cli/src/commands/team.ts#selectTeamImplementer',
        capability: 'Deterministic implementer selector for Team Agents based on task paths, deliverables, language hints, and safe generic fallback.',
        downstreamTasks: ['TASK-TEAM-0010']
    },
    'team.start-runtime-state': {
        anchor: 'packages/cli/src/commands/team.ts#writeTeamRun',
        capability: 'Team run runtime record writer under .atm/runtime/team-runs.',
        downstreamTasks: ['TASK-TEAM-0011']
    },
    'team.status-runtime-read': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamStatusResult',
        capability: 'Read-only team run status surface.',
        downstreamTasks: ['TASK-TEAM-0011']
    },
    'team.runtime-mode-contract': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamRuntimeContract',
        capability: 'Neutral Team runtime mode and adapter metadata contract for real-agent, editor-subagent, and broker-only execution surfaces.',
        downstreamTasks: ['TASK-TEAM-0031']
    },
    'team.patrol-report': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamPatrolReport',
        capability: 'Read-only patrol report for runtime mode, broker-governance evidence gates, rework readiness, missing artifacts, and retry-budget risk.',
        downstreamTasks: ['TASK-TEAM-0014']
    },
    'team.permission-lease-validator': {
        anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
        capability: 'Deterministic permission lease validation before team runtime start.',
        downstreamTasks: ['TASK-TEAM-0012']
    },
    'team.file-write-scope-validator': {
        anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
        capability: 'Deterministic file.write lease scope validation against task allowed files before team runtime start.',
        downstreamTasks: ['TASK-TEAM-0013']
    },
    'team.lease-fencing-deadlock-contract': {
        anchor: 'packages/core/src/governance/scope-lock.ts#validateScopeLeaseFencing',
        capability: 'Team lease fencing diagnostics for duplicate exclusive owners, stale lease epochs, wait-for cycles, released tombstones, and allowedFiles write boundaries across real-agent, editor-subagent, and broker-only runs.',
        downstreamTasks: ['TASK-TEAM-0018']
    },
    'team.next-recommendation': {
        anchor: 'packages/cli/src/commands/team.ts#buildTeamRecommendation',
        capability: 'Advisory next/playbook teamRecommendation surface with plan/start/status/reason command hints without auto-running team commands.',
        downstreamTasks: ['TASK-TEAM-0015']
    },
    'team.knowledge-build-query': {
        anchor: 'packages/cli/src/commands/team-knowledge.ts#runTeamKnowledge',
        capability: 'Advisory Team Agents knowledge build/query dry-run surface with metadata filtering and lexical ranking.',
        downstreamTasks: ['TASK-TEAM-0021']
    },
    'team.broker-conflict-resolution': {
        anchor: 'packages/cli/src/commands/team.ts#runTeamBrokerConflictResolve',
        capability: 'Team Broker conflict resolve command that emits atm.brokerConflictResolution.v1 artifacts with decisionClass, decisionReason, violationStatus, and broker-conflict-blocked release-order semantics.',
        downstreamTasks: ['TASK-TEAM-0046']
    }
};
