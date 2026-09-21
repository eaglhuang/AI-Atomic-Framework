/**
 * Closure assurance reducer.
 *
 * Quality assurance for a checkpoint is a long-lived, resumable question: some
 * obligations are proven, some are still open, some can never be exercised, and
 * occasionally one is actively refuted. Modelling that as a mutable status field
 * loses the middle — a run that stops is either "pass" or "fail" and the partial
 * progress disappears with it.
 *
 * This module models it as an append-only event stream reduced to a public view.
 * The reducer is deterministic and idempotent: the same events in the same run
 * always produce the same view, and re-applying an event that was already seen
 * is reported rather than counted twice. That is what makes a run replayable
 * from its recorded events instead of from the process that produced them.
 *
 * Nothing here reads the file system, a clock, or a validator. Callers reach it
 * through the `QualityGauntlet` facade; downstream selectors read the events.
 */
import { createHash } from 'node:crypto';
export const CLOSURE_ASSURANCE_MACHINE_ID = 'atm.closureAssuranceMachine.v1';
export const CLOSURE_ASSURANCE_VIEW_SCHEMA_ID = 'atm.closureAssuranceView.v1';
export const QUALITY_GAUNTLET_EVENT_SCHEMA_ID = 'atm.qualityGauntletEvent.v1';
export function createQualityGauntletEvent(input) {
    const payload = {
        kind: input.kind,
        runId: text(input.runId),
        checkpoint: text(input.checkpoint),
        occurredAt: text(input.occurredAt),
        obligationId: nullableText(input.obligationId),
        semanticFamily: nullableText(input.semanticFamily),
        owningSeam: nullableText(input.owningSeam),
        validatorCommand: nullableText(input.validatorCommand),
        validatorCaseId: nullableText(input.validatorCaseId),
        outcome: input.outcome ?? null,
        detail: nullableText(input.detail)
    };
    return {
        schemaId: QUALITY_GAUNTLET_EVENT_SCHEMA_ID,
        specVersion: '0.1.0',
        eventId: `atm.qge:${digest(payload).slice('sha256:'.length, 'sha256:'.length + 16)}`,
        ...payload
    };
}
/**
 * Reduce a recorded stream into the public view. This is the whole semantic
 * definition of a run: `ClosureAssuranceMachine` is a thin incremental wrapper
 * over it, so live and replayed runs cannot drift apart.
 */
export function reduceClosureAssurance(input) {
    const machine = new ClosureAssuranceMachine({ runId: input.runId, checkpoint: input.checkpoint });
    for (const event of input.events)
        machine.apply(event);
    return machine.view();
}
export class ClosureAssuranceMachine {
    #runId;
    #checkpoint;
    #obligations = new Map();
    #applied = [];
    #duplicates = new Set();
    #diagnostics = [];
    #counterexamples = [];
    #log = [];
    #terminalState = null;
    constructor(init) {
        this.#runId = text(init.runId);
        this.#checkpoint = text(init.checkpoint);
    }
    /** Apply one event and return the view it produces. Never throws on a bad event. */
    apply(event) {
        if (event.runId !== this.#runId) {
            this.#diagnose('ATM_ASSURANCE_RUN_MISMATCH', event, `Event belongs to run ${event.runId}, not ${this.#runId}.`);
            return this.view();
        }
        if (this.#applied.includes(event.eventId)) {
            this.#duplicates.add(event.eventId);
            this.#diagnose('ATM_ASSURANCE_DUPLICATE_EVENT', event, 'Event was already applied to this run.');
            return this.view();
        }
        // A terminal run keeps everything it proved; later events are recorded as
        // diagnostics so the gap between what happened and what counted stays
        // visible instead of being silently absorbed.
        if (this.#terminalState) {
            this.#diagnose('ATM_ASSURANCE_EVENT_AFTER_TERMINAL', event, `Run is already ${this.#terminalState}.`);
            return this.view();
        }
        this.#applied.push(event.eventId);
        this.#log.push(event);
        this.#absorb(event);
        return this.view();
    }
    view() {
        const obligations = [...this.#obligations.values()]
            .map((record) => ({
            obligationId: record.obligationId,
            semanticFamily: record.semanticFamily,
            owningSeam: record.owningSeam,
            status: record.status,
            validatorCommands: [...record.validatorCommands].sort()
        }))
            .sort((left, right) => left.obligationId.localeCompare(right.obligationId));
        const progress = summarize(obligations);
        const state = this.#terminalState ?? 'running';
        // The digest covers the assurance answer and the events that produced it,
        // not the observability around them. Re-delivering an event or hearing from
        // another run must be reported without changing what this run concluded —
        // otherwise an at-least-once event transport could never prove idempotency.
        const assured = {
            runId: this.#runId,
            checkpoint: this.#checkpoint,
            state,
            obligations,
            counterexamples: this.#counterexamples,
            progress,
            appliedEventIds: [...this.#applied].sort()
        };
        return {
            schemaId: CLOSURE_ASSURANCE_VIEW_SCHEMA_ID,
            specVersion: '0.1.0',
            machineId: CLOSURE_ASSURANCE_MACHINE_ID,
            ...assured,
            duplicateEventIds: [...this.#duplicates].sort(),
            diagnostics: this.#diagnostics,
            verdict: verdictOf(state),
            terminal: state !== 'running',
            viewDigest: digest(assured)
        };
    }
    /** The recorded stream, in the order it was applied. */
    events() {
        return [...this.#log];
    }
    #absorb(event) {
        if (event.kind === 'obligation-observed' && event.obligationId) {
            const record = this.#record(event.obligationId, event);
            if (event.outcome === 'excluded')
                record.status = 'excluded';
            return;
        }
        if (event.kind === 'validator-progress' && event.obligationId) {
            const known = this.#obligations.has(event.obligationId);
            const record = this.#record(event.obligationId, event);
            if (!known) {
                record.status = 'unknown';
                this.#diagnose('ATM_ASSURANCE_UNKNOWN_OBLIGATION', event, `Validator progress referenced unobserved obligation ${event.obligationId}.`);
            }
            if (event.validatorCommand)
                record.validatorCommands.add(event.validatorCommand);
            // A pass only covers an obligation the run actually declared. Promoting an
            // undeclared one would let a validator vouch for coverage of something
            // outside the obligation model — the run has to stay unknown instead.
            const promotable = record.status === 'pending';
            if (event.outcome === 'pass' && promotable)
                record.status = 'covered';
            return;
        }
        if (event.kind === 'counterexample-found') {
            if (event.obligationId)
                this.#record(event.obligationId, event).status = 'counterexample';
            this.#counterexamples.push({
                obligationId: event.obligationId,
                validatorCommand: event.validatorCommand,
                detail: event.detail,
                observedAt: event.occurredAt
            });
            this.#terminalState = 'blocked-counterexample';
            return;
        }
        if (event.kind === 'assurance-indeterminate') {
            this.#terminalState = 'indeterminate';
            return;
        }
        if (event.kind === 'assurance-stopped') {
            this.#terminalState = this.#stopVerdict(event);
        }
    }
    /**
     * Stopping does not by itself prove anything. A stop is `proven` only when
     * every obligation is covered, `sufficient` when the remainder is explicitly
     * excluded, and otherwise `indeterminate` with the open work named.
     */
    #stopVerdict(event) {
        const records = [...this.#obligations.values()];
        const open = records.filter((record) => record.status === 'pending' || record.status === 'unknown');
        if (open.length > 0) {
            this.#diagnose('ATM_ASSURANCE_STOP_WITH_OPEN_OBLIGATIONS', event, `Run stopped with ${open.length} obligation(s) still open: ${open.map((record) => record.obligationId).join(', ')}.`);
            return 'indeterminate';
        }
        if (records.some((record) => record.status === 'counterexample'))
            return 'blocked-counterexample';
        return records.some((record) => record.status === 'excluded') ? 'stopped-sufficient' : 'stopped-proven';
    }
    #record(obligationId, event) {
        const existing = this.#obligations.get(obligationId);
        if (existing) {
            existing.semanticFamily = existing.semanticFamily ?? event.semanticFamily;
            existing.owningSeam = existing.owningSeam ?? event.owningSeam;
            return existing;
        }
        const created = {
            obligationId,
            semanticFamily: event.semanticFamily,
            owningSeam: event.owningSeam,
            status: 'pending',
            validatorCommands: new Set()
        };
        this.#obligations.set(obligationId, created);
        return created;
    }
    #diagnose(code, event, detail) {
        this.#diagnostics.push({ code, eventId: event.eventId, kind: event.kind, detail });
    }
}
function verdictOf(state) {
    if (state === 'stopped-proven')
        return 'proven';
    if (state === 'stopped-sufficient')
        return 'sufficient';
    if (state === 'blocked-counterexample')
        return 'blocked';
    if (state === 'indeterminate')
        return 'indeterminate';
    return 'in-progress';
}
function summarize(obligations) {
    const progress = { total: obligations.length, covered: 0, pending: 0, unknown: 0, excluded: 0, counterexample: 0 };
    for (const obligation of obligations)
        progress[obligation.status] += 1;
    return progress;
}
function digest(value) {
    return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
function text(value) {
    return String(value ?? '').trim();
}
function nullableText(value) {
    const normalized = text(value);
    return normalized.length > 0 ? normalized : null;
}
