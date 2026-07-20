import { attachDirtyGuardToScopedDiffIsolation, buildCloseScopedDiffIsolation, evaluateFrameworkCloseDirtyGuard } from '../scope-lock-diagnostics.js';
function fail(message) {
    console.error(`[scope-lock-diagnostics.test] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
const declaredFiles = [
    'packages/cli/src/commands/tasks.ts',
    'packages/cli/src/commands/tasks/scope-lock-diagnostics.ts',
    '.atm/history/evidence/TASK-CID-0056.*'
];
const dirtyGuard = evaluateFrameworkCloseDirtyGuard({
    cwd: process.cwd(),
    taskId: 'TASK-CID-0056',
    taskDeclaredFiles: declaredFiles,
    trackedDirtyFiles: [
        'packages/cli/src/commands/tasks.ts',
        '.atm/history/evidence/TASK-CID-0056.json',
        '.atm/history/evidence/TASK-CID-0056.bundle-manifest.json',
        '.atm/history/evidence/TASK-CID-0056.closure-packet.json',
        'release/atm-onefile/atm.mjs',
        'scripts/unrelated.ts'
    ]
});
assert(!dirtyGuard.ok, 'in-scope and same-task governance files must block close');
assert(dirtyGuard.reason === 'blocking-dirty-files-present', 'blocking reason must be stable');
assert(dirtyGuard.scopeTrackedDirtyFiles.includes('packages/cli/src/commands/tasks.ts'), 'scope file must be in scope bucket');
assert(dirtyGuard.governanceTrackedDirtyFiles.includes('.atm/history/evidence/TASK-CID-0056.json'), 'same-task evidence must be governance bucket');
assert(dirtyGuard.advisoryTrackedDirtyFiles.includes('.atm/history/evidence/TASK-CID-0056.bundle-manifest.json'), 'same-task bundle manifest must be advisory');
assert(dirtyGuard.regenerableArtifactFiles.includes('.atm/history/evidence/TASK-CID-0056.bundle-manifest.json'), 'same-task bundle manifest must be regenerable');
assert(dirtyGuard.regenerableArtifactFiles.includes('.atm/history/evidence/TASK-CID-0056.closure-packet.json'), 'same-task closure packet must be regenerable when dirty');
const closureOnlyGuard = evaluateFrameworkCloseDirtyGuard({
    cwd: process.cwd(),
    taskId: 'TASK-CID-0056',
    taskDeclaredFiles: declaredFiles,
    trackedDirtyFiles: [
        '.atm/history/evidence/TASK-CID-0056.closure-packet.json',
        '.atm/history/evidence/TASK-CID-0056.bundle-manifest.json'
    ]
});
assert(closureOnlyGuard.ok, 'regenerable artifacts alone must not block close');
assert(closureOnlyGuard.regenerableArtifactFiles.length === 2, 'both regenerable artifacts must be classified');
assert(dirtyGuard.generatedArtifactFiles.includes('release/atm-onefile/atm.mjs'), 'release runner output must be generated artifact bucket');
assert(dirtyGuard.advisoryTrackedDirtyFiles.includes('scripts/unrelated.ts'), 'unrelated source must be advisory bucket');
assert(dirtyGuard.remediation.requiredCommand?.includes('node atm.mjs git commit'), 'blocking guard must expose governed commit command');
assert(dirtyGuard.remediation.requiredCommand?.includes('--auto-stage'), 'blocking guard commit remediation must include --auto-stage');
assert(dirtyGuard.remediation.safeToAutoStage === false, 'diagnostic atom must never authorize auto-staging');
const cleanGuard = evaluateFrameworkCloseDirtyGuard({
    cwd: process.cwd(),
    taskId: 'TASK-CID-0056',
    taskDeclaredFiles: declaredFiles,
    trackedDirtyFiles: [
        'release/atm-root-drop/packages/cli/dist/commands/tasks.js',
        'scripts/unrelated.ts'
    ]
});
assert(cleanGuard.ok, 'generated and unrelated tracked files must be advisory only');
assert(cleanGuard.blockingTrackedDirtyFiles.length === 0, 'advisory-only state must not have blockers');
assert(cleanGuard.remediation.requiredCommand === null, 'advisory-only state must not require a command');
const historicalEvidenceGuard = evaluateFrameworkCloseDirtyGuard({
    cwd: process.cwd(),
    taskId: 'TASK-CID-0056',
    taskDeclaredFiles: declaredFiles,
    trackedDirtyFiles: [
        '.atm/history/evidence/TASK-CID-0056.json'
    ],
    allowedAdvisoryGovernanceFiles: [
        '.atm/history/evidence/TASK-CID-0056.json'
    ]
});
assert(historicalEvidenceGuard.ok, 'allowlisted same-task evidence must not block historical-delivery close');
assert(historicalEvidenceGuard.governanceTrackedDirtyFiles.length === 0, 'allowlisted same-task evidence must leave governance blockers empty');
assert(historicalEvidenceGuard.advisoryTrackedDirtyFiles.includes('.atm/history/evidence/TASK-CID-0056.json'), 'allowlisted same-task evidence must become advisory');
const isolation = buildCloseScopedDiffIsolation({
    cwd: process.cwd(),
    taskId: 'TASK-CID-0056',
    taskDeclaredFiles: declaredFiles,
    frameworkChangedFiles: [
        'packages/cli/src/commands/tasks.ts',
        'packages/cli/src/commands/next.ts'
    ],
    frameworkDeliveryWindow: {
        scopedCriticalChangedFiles: ['packages/cli/src/commands/tasks.ts'],
        unscopedCriticalChangedFiles: ['packages/cli/src/commands/next.ts'],
        declaredFiles
    }
});
assert(isolation.summary === 'mixed-in-scope-and-isolated-changes', 'mixed isolation summary must be deterministic');
assert(isolation.declaredButUnchanged.includes('packages/cli/src/commands/tasks/scope-lock-diagnostics.ts'), 'unchanged declared file must stay visible');
const attached = attachDirtyGuardToScopedDiffIsolation(isolation, dirtyGuard, ['scratch/local.log']);
assert(attached?.blockingTrackedDirtyFiles?.includes('packages/cli/src/commands/tasks.ts'), 'attached report must preserve blocking files');
assert(attached?.generatedArtifactFiles?.includes('release/atm-onefile/atm.mjs'), 'attached report must preserve generated artifact bucket');
assert(attached?.ignoredUntrackedFiles?.includes('scratch/local.log'), 'attached report must preserve ignored untracked files');
console.log('[scope-lock-diagnostics.test] ok');
