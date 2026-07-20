import { type ImportedTaskSummary } from '../route-predicates.ts';
interface PendingTaskArtifactScopeDiagnostic {
    readonly schemaId: 'atm.taskArtifactScopeDiagnostic.v1';
    readonly ignoredUntrackedFiles: readonly string[];
    readonly advisoryTrackedFiles: readonly string[];
}
/**
 * TASK-AAO-0011: claim/checkpoint must not hard-block on unrelated untracked
 * files (e.g. an unrelated svg in `docs/assets/`, a peer agent's WIP, screenshots,
 * tmp patches). Untracked candidates are demoted to a warning surfaced via
 * `ignoredUntrackedFiles`; the claim still produces a valid direction lock.
 *
 * The hard-block path remains for STAGED or MODIFIED-TRACKED files that look
 * like a deliverable for this task but live outside its allowedFiles — those
 * are the real "scope expansion required" cases that demand
 * `tasks scope --add` instead of editing runtime locks.
 */
export declare function checkPendingTaskArtifactScopeExpansion(input: {
    readonly cwd: string;
    readonly task: ImportedTaskSummary;
}): PendingTaskArtifactScopeDiagnostic;
export declare function buildNonPlaybookRouteHints(cwd: string, prompt: string): {
    playbookState: "absent";
    structuredOutputHint: {
        schemaId: "atm.nextStructuredOutputHint.v1";
        hasPlaybook: boolean;
        treatCliJsonAs: "structured-tool-guidance";
        followNextActionField: "evidence.nextAction.command";
    };
    ignoredArtifactForceAddHints: {
        path: string;
        requiredCommand: string;
        reason: string;
    }[];
    promptWorktreeHint: {
        schemaId: "atm.promptWorktreeHint.v1";
        promptPathHints: string[];
        promptMatchedFiles: string[];
        atmManagedFiles: string[];
        generatedArtifactFiles: string[];
        releaseMirrorFiles: string[];
        unrelatedTrackedFiles: string[];
        unrelatedUntrackedFiles: string[];
        ignoredArtifactCount: number;
        note: string;
    };
};
export {};
