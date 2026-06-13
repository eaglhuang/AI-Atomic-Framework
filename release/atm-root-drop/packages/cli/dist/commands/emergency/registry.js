export const emergencyPermissionRegistry = Object.freeze([
    {
        id: 'backend.tasks.close',
        summary: 'Direct tasks close backend mutation outside the taskflow operator lane.',
        protectedSurfaces: ['tasks close'],
        normalLane: 'taskflow close',
        riskTier: 'high',
        defaultTtlMinutes: 30,
        defaultMaxUses: 1,
        requiresTaskId: true,
        requiresActor: true,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-backend-close', 'taskflow-operator-lane']
    },
    {
        id: 'backend.tasks.reconcile',
        summary: 'Direct tasks reconcile historical-delivery closeback.',
        protectedSurfaces: ['tasks reconcile'],
        normalLane: 'taskflow close',
        riskTier: 'high',
        defaultTtlMinutes: 30,
        defaultMaxUses: 1,
        requiresTaskId: true,
        requiresActor: true,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-backend-reconcile', 'historical-delivery']
    },
    {
        id: 'backend.tasks.import.write',
        summary: 'Direct tasks import --write runtime mutation.',
        protectedSurfaces: ['tasks import --write'],
        normalLane: 'taskflow open',
        riskTier: 'high',
        defaultTtlMinutes: 30,
        defaultMaxUses: 2,
        requiresTaskId: false,
        requiresActor: false,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-backend-import', 'taskflow-open']
    },
    {
        id: 'backend.tasks.repairClosure',
        summary: 'Direct tasks repair-closure packet mutation.',
        protectedSurfaces: ['tasks repair-closure'],
        normalLane: 'taskflow close',
        riskTier: 'high',
        defaultTtlMinutes: 30,
        defaultMaxUses: 1,
        requiresTaskId: true,
        requiresActor: false,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-backend-repair-closure', 'closure-packet']
    },
    {
        id: 'backend.tasks.reset',
        summary: 'Task lifecycle reset or force state recovery.',
        protectedSurfaces: ['tasks reset'],
        normalLane: 'explicit recovery route',
        riskTier: 'high',
        defaultTtlMinutes: 20,
        defaultMaxUses: 1,
        requiresTaskId: true,
        requiresActor: true,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-backend-reset', 'task-lifecycle']
    },
    {
        id: 'backend.tasks.lockCleanupGlobal',
        summary: 'Global stale lock cleanup.',
        protectedSurfaces: ['tasks lock cleanup --all-stale'],
        normalLane: 'scoped lock cleanup',
        riskTier: 'medium',
        defaultTtlMinutes: 20,
        defaultMaxUses: 1,
        requiresTaskId: false,
        requiresActor: true,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-lock-cleanup']
    },
    {
        id: 'backend.tasks.scopeAmend',
        summary: 'Direction-lock scope amendment outside the active operator route.',
        protectedSurfaces: ['tasks scope add'],
        normalLane: 'active claim scope amendment',
        riskTier: 'medium',
        defaultTtlMinutes: 20,
        defaultMaxUses: 3,
        requiresTaskId: true,
        requiresActor: true,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-scope-amend']
    },
    {
        id: 'backend.waiver.historicalDeliveryOutOfScope',
        summary: 'Historical delivery out-of-scope waiver.',
        protectedSurfaces: ['--waiver-out-of-scope-delivery'],
        normalLane: 'narrow historical delivery verification',
        riskTier: 'high',
        defaultTtlMinutes: 20,
        defaultMaxUses: 1,
        requiresTaskId: true,
        requiresActor: true,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-waiver', 'historical-delivery']
    },
    {
        id: 'backend.runnerRecovery',
        summary: 'Stale runner recovery override.',
        protectedSurfaces: ['--allow-stale-runner'],
        normalLane: 'build and sync runner first',
        riskTier: 'high',
        defaultTtlMinutes: 20,
        defaultMaxUses: 1,
        requiresTaskId: false,
        requiresActor: false,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-runner-recovery']
    },
    {
        id: 'backend.gitHookBypass',
        summary: 'Governed git hook bypass recovery.',
        protectedSurfaces: ['git recovery flags'],
        normalLane: 'governed git commit wrapper',
        riskTier: 'critical',
        defaultTtlMinutes: 10,
        defaultMaxUses: 1,
        requiresTaskId: false,
        requiresActor: true,
        requiresHumanApprovalText: true,
        auditRequired: true,
        validatorTags: ['emergency-git-hook-bypass']
    }
]);
export function getEmergencyPermission(id) {
    return emergencyPermissionRegistry.find((entry) => entry.id === id) ?? null;
}
export function listEmergencyPermissionIds() {
    return emergencyPermissionRegistry.map((entry) => entry.id);
}
