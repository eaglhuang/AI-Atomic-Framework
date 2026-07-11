/**
 * TASK-RFT-0010 — tasks.close.governance atom.
 *
 * Policy Object for `tasks close` admission. Owns:
 *   - close-authority predicate (who can close which task)
 *   - closure-packet trust verdict (is the packet recoverable?)
 *   - blocker-code classification (which code class is the blocker?)
 *   - stale-runner override audit recording
 *   - failed-emergency-use audit recording
 *
 * Behaviour is preserved verbatim — `recordStaleRunnerOverride` and
 * `recordFailedEmergencyUseAttempt` are lifted from the inline body of
 * `packages/cli/src/commands/tasks.ts` with no logic changes. The blocker-code
 * classifier codifies the implicit taxonomy already used by inline `throw new
 * CliError(...)` sites; it does not alter the codes that fly out, only adds a
 * single named choke point so close-time policy can fan out cleanly.
 */
import type { EmergencyPermissionId } from '../emergency/registry.ts';
/**
 * Stable family vocabulary for `tasks close` blocker codes. Used by callers
 * that want to fan out on the *kind* of failure rather than on a free-form
 * code string. The actual CliError.code strings remain unchanged in
 * `runTasksClose`; this just classifies them.
 */
export type TaskCloseBlockerClass = 'usage' | 'identity' | 'authority' | 'lifecycle' | 'historical-delivery' | 'deliverable-gate' | 'closure-packet' | 'dependency-gate' | 'scope-lock' | 'runner-stale' | 'emergency-protected' | 'unknown';
export interface TaskCloseBlockerClassification {
    readonly cliErrorCode: string;
    readonly blockerClass: TaskCloseBlockerClass;
    /**
     * True when the blocker is recoverable inside the same close attempt by
     * running an automated repair (e.g. closure-packet repair). False when the
     * operator must take a manual action first (auth, identity, lifecycle).
     */
    readonly recoverable: boolean;
}
/**
 * Classify a CliError.code emitted from the close path into a blocker family
 * + recoverability verdict. Unknown codes fall through to `unknown / false`.
 */
export declare function classifyTaskCloseBlockerCode(cliErrorCode: string): TaskCloseBlockerClassification;
export interface TaskCloseAuthorityInput {
    readonly currentOwner: string | null;
    readonly actorId: string | null;
}
export interface TaskCloseAuthorityVerdict {
    readonly allowed: boolean;
    readonly reason: 'owner-match' | 'no-current-owner' | 'owner-mismatch' | 'missing-actor';
}
/**
 * Compute close authority. The operator is allowed to close when their actorId
 * matches the current claim owner (or when no owner is recorded yet). Caller
 * is responsible for throwing the appropriate CliError when `allowed === false`.
 */
export declare function computeTaskCloseAuthority(input: TaskCloseAuthorityInput): TaskCloseAuthorityVerdict;
export interface ClosurePacketTrustInput {
    readonly packetPresent: boolean;
    readonly packetValid: boolean;
    readonly packetSchemaIdMatches: boolean;
    readonly repairAvailable: boolean;
}
export interface ClosurePacketTrustVerdict {
    readonly trusted: boolean;
    readonly verdict: 'trusted' | 'recoverable-repair' | 'rejected-missing' | 'rejected-invalid' | 'rejected-schema-mismatch';
}
export declare function evaluateClosurePacketTrust(input: ClosurePacketTrustInput): ClosurePacketTrustVerdict;
export interface RecordStaleRunnerOverrideInput {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string | null;
    readonly action: string;
    readonly command: string;
}
export declare function recordStaleRunnerOverride(input: RecordStaleRunnerOverrideInput): Promise<true | null>;
export declare function isCliErrorWithCode(error: unknown, codePrefix: string): boolean;
export interface RecordFailedEmergencyUseAttemptInput {
    readonly cwd: string;
    readonly leaseId: string | null | undefined;
    readonly permission: EmergencyPermissionId;
    readonly surface: string;
    readonly taskId: string;
    readonly actorId: string | null;
    readonly reason: string | null;
    readonly command: string | null;
    readonly failureCode: string | null;
    readonly flags?: readonly string[];
}
export declare function recordFailedEmergencyUseAttempt(input: RecordFailedEmergencyUseAttemptInput): string | null;
