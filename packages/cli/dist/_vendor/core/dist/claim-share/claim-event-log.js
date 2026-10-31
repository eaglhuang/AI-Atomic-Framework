/**
 * Append-only claim event log (prereg v3 W4).
 * One JSON object per line in `.atm/runtime/claim-events.jsonl`.
 * Lines are only ever appended with O_APPEND; nothing in ATM rewrites or truncates this file.
 * Each event carries a wall-clock ISO stamp (`at`) and a CLOCK_MONOTONIC stamp (`monoNs`)
 * so notice latency can be measured even across wall-clock steps.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
export const claimEventLogRelativePath = path.join('.atm', 'runtime', 'claim-events.jsonl');
export function claimEventLogPath(cwd) {
    return path.join(cwd, claimEventLogRelativePath);
}
/** Appends one event. Callers must hold the claim-share lock so `seq` stays strictly increasing. */
export function appendClaimEvent(cwd, seq, nowMs, input) {
    const event = {
        schemaId: 'atm.claimEvent.v1',
        seq,
        at: new Date(nowMs).toISOString(),
        monoNs: process.hrtime.bigint().toString(),
        type: input.type,
        actorId: input.actorId,
        claimId: input.claimId ?? null,
        files: [...(input.files ?? [])],
        relatedClaimIds: [...(input.relatedClaimIds ?? [])],
        detail: { ...(input.detail ?? {}) }
    };
    const logPath = claimEventLogPath(cwd);
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
    return event;
}
export function readClaimEvents(cwd) {
    const logPath = claimEventLogPath(cwd);
    if (!existsSync(logPath))
        return [];
    return readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
}
