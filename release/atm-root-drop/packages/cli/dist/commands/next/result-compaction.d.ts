/**
 * Trims the default `next` CLI envelope so ordinary prompt-scoped routes stay
 * readable in agent/tool transcripts. This only removes duplicated or
 * oversized diagnostic content that remains fully reachable elsewhere
 * (evidence.nextAction.playbook stays untouched; framework-mode status --json
 * keeps the full file lists). Pass --verbose to bypass this and get the
 * original untrimmed envelope. See ATM-BUG-2026-07-07-041.
 */
export declare function compactNextRouteResult<T extends {
    evidence?: Record<string, unknown>;
    messages?: unknown[];
}>(result: T): T;
