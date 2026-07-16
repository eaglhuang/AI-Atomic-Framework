// @ts-nocheck
export { enrichWithLegacyPlan } from './playbook-projection/legacy-guidance.js';
export { buildAgentPackHint, buildMirrorSyncNextAction, buildActiveTaskDivergenceResult } from './playbook-projection/task-routing.js';
export { buildActiveWorkSummary, inspectFreshTaskReservationForTask, normalizeWorkPath } from './playbook-projection/active-work-summary.js';
export { buildTaskDeliveryPrinciple, buildChannelPlaybook } from './playbook-projection/channel-playbook.js';
export { embedTeamRecommendation, buildNextMessages } from './playbook-projection/message-assembly.js';
export { buildGovernanceReadinessHint, shouldInspectCrossRepoFrameworkStatus } from './playbook-projection/governance-readiness.js';
