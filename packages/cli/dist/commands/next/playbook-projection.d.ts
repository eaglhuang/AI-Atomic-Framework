export { enrichWithLegacyPlan } from './playbook-projection/legacy-guidance.ts';
export { buildAgentPackHint, buildMirrorSyncNextAction, buildActiveTaskDivergenceResult } from './playbook-projection/task-routing.ts';
export { buildActiveWorkSummary, inspectFreshTaskReservationForTask, normalizeWorkPath } from './playbook-projection/active-work-summary.ts';
export { buildTaskDeliveryPrinciple, buildChannelPlaybook } from './playbook-projection/channel-playbook.ts';
export { embedTeamRecommendation, buildNextMessages } from './playbook-projection/message-assembly.ts';
export { buildGovernanceReadinessHint, shouldInspectCrossRepoFrameworkStatus } from './playbook-projection/governance-readiness.ts';
