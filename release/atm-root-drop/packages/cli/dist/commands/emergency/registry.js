export const emergencyPermissionRegistry = Object.freeze([
    {
        id: 'backend.tasks.close',
        summary: 'Direct tasks close backend mutation outside the taskflow operator lane.',
        protectedSurfaces: ['tasks close'],
        defaultTtlMinutes: 30,
        defaultMaxUses: 1
    },
    {
        id: 'backend.tasks.reconcile',
        summary: 'Direct tasks reconcile historical-delivery closeback.',
        protectedSurfaces: ['tasks reconcile'],
        defaultTtlMinutes: 30,
        defaultMaxUses: 1
    },
    {
        id: 'backend.tasks.import.write',
        summary: 'Direct tasks import --write runtime mutation.',
        protectedSurfaces: ['tasks import --write'],
        defaultTtlMinutes: 30,
        defaultMaxUses: 2
    },
    {
        id: 'backend.tasks.repairClosure',
        summary: 'Direct tasks repair-closure packet mutation.',
        protectedSurfaces: ['tasks repair-closure'],
        defaultTtlMinutes: 30,
        defaultMaxUses: 1
    },
    {
        id: 'backend.tasks.reset',
        summary: 'Task lifecycle reset or force state recovery.',
        protectedSurfaces: ['tasks reset'],
        defaultTtlMinutes: 20,
        defaultMaxUses: 1
    },
    {
        id: 'backend.tasks.lockCleanupGlobal',
        summary: 'Global stale lock cleanup.',
        protectedSurfaces: ['tasks lock cleanup --all-stale'],
        defaultTtlMinutes: 20,
        defaultMaxUses: 1
    },
    {
        id: 'backend.tasks.scopeAmend',
        summary: 'Direction-lock scope amendment outside the active operator route.',
        protectedSurfaces: ['tasks scope add'],
        defaultTtlMinutes: 20,
        defaultMaxUses: 3
    },
    {
        id: 'backend.waiver.historicalDeliveryOutOfScope',
        summary: 'Historical delivery out-of-scope waiver.',
        protectedSurfaces: ['--waiver-out-of-scope-delivery'],
        defaultTtlMinutes: 20,
        defaultMaxUses: 1
    },
    {
        id: 'backend.runnerRecovery',
        summary: 'Stale runner recovery override.',
        protectedSurfaces: ['--allow-stale-runner'],
        defaultTtlMinutes: 20,
        defaultMaxUses: 1
    },
    {
        id: 'backend.gitHookBypass',
        summary: 'Governed git hook bypass recovery.',
        protectedSurfaces: ['git recovery flags'],
        defaultTtlMinutes: 10,
        defaultMaxUses: 1
    }
]);
export function getEmergencyPermission(id) {
    return emergencyPermissionRegistry.find((entry) => entry.id === id) ?? null;
}
export function listEmergencyPermissionIds() {
    return emergencyPermissionRegistry.map((entry) => entry.id);
}
