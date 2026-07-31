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

export const CLOSURE_ASSURANCE_MACHINE_ID = 'atm.closureAssuranceMachine.v1' as const;
export const CLOSURE_ASSURANCE_VIEW_SCHEMA_ID = 'atm.closureAssuranceView.v1' as const;
export const QUALITY_GAUNTLET_EVENT_SCHEMA_ID = 'atm.qualityGauntletEvent.v1' as const;

export type QualityGauntletEventKind =
  | 'assurance-started'
  | 'obligation-observed'
  | 'validator-progress'
  | 'counterexample-found'
  | 'assurance-indeterminate'
  | 'assurance-stopped';

export type QualityGauntletEventOutcome = 'pass' | 'fail' | 'skipped' | 'excluded' | 'unknown';

/**
 * `running` is the only non-terminal state. The four terminal states are kept
 * distinct on purpose: "we proved it", "what is left can never be exercised",
 * "we have a counterexample", and "we could not tell" are different answers to
 * a closeback question, and collapsing them loses the reason.
 */
export type ClosureAssuranceState =
  | 'running'
  | 'stopped-proven'
  | 'stopped-sufficient'
  | 'blocked-counterexample'
  | 'indeterminate';

export type ClosureAssuranceVerdict = 'in-progress' | 'proven' | 'sufficient' | 'blocked' | 'indeterminate';

export type ClosureAssuranceObligationStatus = 'pending' | 'covered' | 'excluded' | 'counterexample' | 'unknown';

export type ClosureAssuranceDiagnosticCode =
  | 'ATM_ASSURANCE_DUPLICATE_EVENT'
  | 'ATM_ASSURANCE_EVENT_AFTER_TERMINAL'
  | 'ATM_ASSURANCE_RUN_MISMATCH'
  | 'ATM_ASSURANCE_UNKNOWN_OBLIGATION'
  | 'ATM_ASSURANCE_STOP_WITH_OPEN_OBLIGATIONS';

/**
 * The public event contract. Every field is readable by downstream selection
 * without touching reducer state, which is what lets validator catalog work
 * consume a run without coupling to how the run was computed.
 */
export interface QualityGauntletEvent {
  readonly schemaId: typeof QUALITY_GAUNTLET_EVENT_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  /** Canonical digest of the payload: identical observations are one event. */
  readonly eventId: string;
  readonly kind: QualityGauntletEventKind;
  readonly runId: string;
  readonly checkpoint: string;
  readonly occurredAt: string;
  readonly obligationId: string | null;
  readonly semanticFamily: string | null;
  readonly owningSeam: string | null;
  readonly validatorCommand: string | null;
  readonly validatorCaseId: string | null;
  readonly outcome: QualityGauntletEventOutcome | null;
  readonly detail: string | null;
}

export interface QualityGauntletEventInput {
  readonly kind: QualityGauntletEventKind;
  readonly runId: string;
  readonly checkpoint: string;
  readonly occurredAt: string;
  readonly obligationId?: string | null;
  readonly semanticFamily?: string | null;
  readonly owningSeam?: string | null;
  readonly validatorCommand?: string | null;
  readonly validatorCaseId?: string | null;
  readonly outcome?: QualityGauntletEventOutcome | null;
  readonly detail?: string | null;
}

export interface ClosureAssuranceObligationProgress {
  readonly obligationId: string;
  readonly semanticFamily: string | null;
  readonly owningSeam: string | null;
  readonly status: ClosureAssuranceObligationStatus;
  readonly validatorCommands: readonly string[];
}

export interface ClosureAssuranceDiagnostic {
  readonly code: ClosureAssuranceDiagnosticCode;
  readonly eventId: string | null;
  readonly kind: QualityGauntletEventKind | null;
  readonly detail: string;
}

export interface ClosureAssuranceCounterexample {
  readonly obligationId: string | null;
  readonly validatorCommand: string | null;
  readonly detail: string | null;
  readonly observedAt: string;
}

export interface ClosureAssuranceProgress {
  readonly total: number;
  readonly covered: number;
  readonly pending: number;
  readonly unknown: number;
  readonly excluded: number;
  readonly counterexample: number;
}

export interface ClosureAssuranceView {
  readonly schemaId: typeof CLOSURE_ASSURANCE_VIEW_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly machineId: typeof CLOSURE_ASSURANCE_MACHINE_ID;
  readonly runId: string;
  readonly checkpoint: string;
  readonly state: ClosureAssuranceState;
  readonly verdict: ClosureAssuranceVerdict;
  readonly terminal: boolean;
  readonly obligations: readonly ClosureAssuranceObligationProgress[];
  readonly counterexamples: readonly ClosureAssuranceCounterexample[];
  readonly progress: ClosureAssuranceProgress;
  readonly appliedEventIds: readonly string[];
  readonly duplicateEventIds: readonly string[];
  readonly diagnostics: readonly ClosureAssuranceDiagnostic[];
  readonly viewDigest: string;
}

export function createQualityGauntletEvent(input: QualityGauntletEventInput): QualityGauntletEvent {
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
export function reduceClosureAssurance(input: {
  readonly runId: string;
  readonly checkpoint: string;
  readonly events: readonly QualityGauntletEvent[];
}): ClosureAssuranceView {
  const machine = new ClosureAssuranceMachine({ runId: input.runId, checkpoint: input.checkpoint });
  for (const event of input.events) machine.apply(event);
  return machine.view();
}

interface ObligationRecord {
  readonly obligationId: string;
  semanticFamily: string | null;
  owningSeam: string | null;
  status: ClosureAssuranceObligationStatus;
  readonly validatorCommands: Set<string>;
}

export class ClosureAssuranceMachine {
  readonly #runId: string;
  readonly #checkpoint: string;
  readonly #obligations = new Map<string, ObligationRecord>();
  readonly #applied: string[] = [];
  readonly #duplicates = new Set<string>();
  readonly #diagnostics: ClosureAssuranceDiagnostic[] = [];
  readonly #counterexamples: ClosureAssuranceCounterexample[] = [];
  readonly #log: QualityGauntletEvent[] = [];
  #terminalState: ClosureAssuranceState | null = null;

  constructor(init: { readonly runId: string; readonly checkpoint: string }) {
    this.#runId = text(init.runId);
    this.#checkpoint = text(init.checkpoint);
  }

  /** Apply one event and return the view it produces. Never throws on a bad event. */
  apply(event: QualityGauntletEvent): ClosureAssuranceView {
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

  view(): ClosureAssuranceView {
    const obligations = [...this.#obligations.values()]
      .map((record): ClosureAssuranceObligationProgress => ({
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
  events(): readonly QualityGauntletEvent[] {
    return [...this.#log];
  }

  #absorb(event: QualityGauntletEvent): void {
    if (event.kind === 'obligation-observed' && event.obligationId) {
      const record = this.#record(event.obligationId, event);
      if (event.outcome === 'excluded') record.status = 'excluded';
      return;
    }
    if (event.kind === 'validator-progress' && event.obligationId) {
      const known = this.#obligations.has(event.obligationId);
      const record = this.#record(event.obligationId, event);
      if (!known) {
        record.status = 'unknown';
        this.#diagnose('ATM_ASSURANCE_UNKNOWN_OBLIGATION', event, `Validator progress referenced unobserved obligation ${event.obligationId}.`);
      }
      if (event.validatorCommand) record.validatorCommands.add(event.validatorCommand);
      // A pass only covers an obligation the run actually declared. Promoting an
      // undeclared one would let a validator vouch for coverage of something
      // outside the obligation model — the run has to stay unknown instead.
      const promotable = record.status === 'pending';
      if (event.outcome === 'pass' && promotable) record.status = 'covered';
      return;
    }
    if (event.kind === 'counterexample-found') {
      if (event.obligationId) this.#record(event.obligationId, event).status = 'counterexample';
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
  #stopVerdict(event: QualityGauntletEvent): ClosureAssuranceState {
    const records = [...this.#obligations.values()];
    const open = records.filter((record) => record.status === 'pending' || record.status === 'unknown');
    if (open.length > 0) {
      this.#diagnose(
        'ATM_ASSURANCE_STOP_WITH_OPEN_OBLIGATIONS',
        event,
        `Run stopped with ${open.length} obligation(s) still open: ${open.map((record) => record.obligationId).join(', ')}.`
      );
      return 'indeterminate';
    }
    if (records.some((record) => record.status === 'counterexample')) return 'blocked-counterexample';
    return records.some((record) => record.status === 'excluded') ? 'stopped-sufficient' : 'stopped-proven';
  }

  #record(obligationId: string, event: QualityGauntletEvent): ObligationRecord {
    const existing = this.#obligations.get(obligationId);
    if (existing) {
      existing.semanticFamily = existing.semanticFamily ?? event.semanticFamily;
      existing.owningSeam = existing.owningSeam ?? event.owningSeam;
      return existing;
    }
    const created: ObligationRecord = {
      obligationId,
      semanticFamily: event.semanticFamily,
      owningSeam: event.owningSeam,
      status: 'pending',
      validatorCommands: new Set<string>()
    };
    this.#obligations.set(obligationId, created);
    return created;
  }

  #diagnose(code: ClosureAssuranceDiagnosticCode, event: QualityGauntletEvent, detail: string): void {
    this.#diagnostics.push({ code, eventId: event.eventId, kind: event.kind, detail });
  }
}

function verdictOf(state: ClosureAssuranceState): ClosureAssuranceVerdict {
  if (state === 'stopped-proven') return 'proven';
  if (state === 'stopped-sufficient') return 'sufficient';
  if (state === 'blocked-counterexample') return 'blocked';
  if (state === 'indeterminate') return 'indeterminate';
  return 'in-progress';
}

function summarize(obligations: readonly ClosureAssuranceObligationProgress[]): ClosureAssuranceProgress {
  const progress = { total: obligations.length, covered: 0, pending: 0, unknown: 0, excluded: 0, counterexample: 0 };
  for (const obligation of obligations) progress[obligation.status] += 1;
  return progress;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized.length > 0 ? normalized : null;
}
