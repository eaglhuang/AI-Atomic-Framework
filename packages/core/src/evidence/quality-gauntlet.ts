/**
 * Quality gauntlet facade.
 *
 * Close, check-in, phase and release checkpoints all need the same thing: "may
 * this proceed, and on what evidence?". They must not each learn how assurance
 * is computed. This facade is the whole caller-facing surface — `advance` moves
 * one run forward, `inspect` reads its public view and event log, and `replay`
 * rebuilds a view from recorded events alone.
 *
 * Everything behind it is the `ClosureAssuranceMachine` event stream. The facade
 * translates a caller's request into events and never exposes reducer state, so
 * later selection, freshness and certificate work can consume the events without
 * coupling to how a verdict was reached.
 */

import { createHash } from 'node:crypto';
import {
  ClosureAssuranceMachine,
  createQualityGauntletEvent,
  reduceClosureAssurance,
  type ClosureAssuranceState,
  type ClosureAssuranceVerdict,
  type ClosureAssuranceView,
  type QualityGauntletEvent
} from './closure-assurance-machine.ts';

export const QUALITY_GAUNTLET_ID = 'atm.qualityGauntlet.v1' as const;
export const QUALITY_GAUNTLET_TRANSITION_SCHEMA_ID = 'atm.qualityGauntletTransition.v1' as const;

/** How the caller ends a run. Omitting it leaves the run resumable. */
export type QualityGauntletStop = 'stop' | 'indeterminate';

export interface QualityGauntletObligationInput {
  readonly obligationId: string;
  readonly semanticFamily?: string | null;
  readonly owningSeam?: string | null;
  /** Declared unreachable or out of scope for this checkpoint. */
  readonly excluded?: boolean;
}

export interface QualityGauntletValidatorResultInput {
  readonly command: string;
  readonly caseId?: string | null;
  readonly outcome: 'pass' | 'fail' | 'skipped' | 'unknown';
  readonly obligationIds: readonly string[];
  readonly detail?: string | null;
}

export interface QualityGauntletRequest {
  readonly runId: string;
  readonly checkpoint: string;
  readonly requestedAt: string;
  readonly obligations: readonly QualityGauntletObligationInput[];
  readonly validatorResults: readonly QualityGauntletValidatorResultInput[];
  readonly stop?: QualityGauntletStop | null;
  readonly stopReason?: string | null;
}

export interface QualityGauntletTransition {
  readonly schemaId: typeof QUALITY_GAUNTLET_TRANSITION_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly gauntletId: typeof QUALITY_GAUNTLET_ID;
  readonly runId: string;
  readonly checkpoint: string;
  readonly fromState: ClosureAssuranceState;
  readonly toState: ClosureAssuranceState;
  readonly verdict: ClosureAssuranceVerdict;
  readonly terminal: boolean;
  readonly emittedEvents: readonly QualityGauntletEvent[];
  readonly view: ClosureAssuranceView;
  readonly transitionDigest: string;
}

export interface QualityGauntletInspection {
  readonly gauntletId: typeof QUALITY_GAUNTLET_ID;
  readonly runId: string;
  readonly checkpoint: string;
  readonly view: ClosureAssuranceView;
  readonly events: readonly QualityGauntletEvent[];
}

export interface QualityGauntletReplayReport {
  readonly gauntletId: typeof QUALITY_GAUNTLET_ID;
  readonly runId: string;
  readonly checkpoint: string;
  readonly view: ClosureAssuranceView;
  readonly replayedEventCount: number;
  readonly duplicateEventIds: readonly string[];
  /** Two independent reductions of the same stream agreed. */
  readonly deterministic: boolean;
}

interface QualityGauntletRun {
  readonly checkpoint: string;
  readonly machine: ClosureAssuranceMachine;
}

export class QualityGauntlet {
  readonly #runs = new Map<string, QualityGauntletRun>();

  /**
   * Move one run forward. A first call starts it; later calls resume it from the
   * recorded events rather than from anything the caller kept, which is what
   * makes a checkpoint safe to retry after an interruption.
   */
  advance(request: QualityGauntletRequest): QualityGauntletTransition {
    const runId = text(request.runId);
    const checkpoint = text(request.checkpoint);
    const existing = this.#runs.get(runId);
    const run = existing ?? { checkpoint, machine: new ClosureAssuranceMachine({ runId, checkpoint }) };
    if (!existing) this.#runs.set(runId, run);
    const fromState = run.machine.view().state;

    const emitted = buildEvents(request, runId, run.checkpoint, existing !== undefined);
    for (const event of emitted) run.machine.apply(event);
    const view = run.machine.view();

    return {
      schemaId: QUALITY_GAUNTLET_TRANSITION_SCHEMA_ID,
      specVersion: '0.1.0',
      gauntletId: QUALITY_GAUNTLET_ID,
      runId,
      checkpoint: run.checkpoint,
      fromState,
      toState: view.state,
      verdict: view.verdict,
      terminal: view.terminal,
      emittedEvents: emitted,
      view,
      transitionDigest: digest({
        runId,
        checkpoint: run.checkpoint,
        fromState,
        toState: view.state,
        emittedEventIds: emitted.map((event) => event.eventId),
        viewDigest: view.viewDigest
      })
    };
  }

  /** The public view and event log of a run, or null when it was never started. */
  inspect(runId: string): QualityGauntletInspection | null {
    const run = this.#runs.get(text(runId));
    if (!run) return null;
    return {
      gauntletId: QUALITY_GAUNTLET_ID,
      runId: text(runId),
      checkpoint: run.checkpoint,
      view: run.machine.view(),
      events: run.machine.events()
    };
  }

  /**
   * Rebuild a view from events alone. This deliberately ignores facade state:
   * an auditor holding only the recorded stream must reach the same verdict as
   * the process that produced it.
   */
  replay(input: {
    readonly runId: string;
    readonly checkpoint: string;
    readonly events: readonly QualityGauntletEvent[];
  }): QualityGauntletReplayReport {
    const runId = text(input.runId);
    const checkpoint = text(input.checkpoint);
    const view = reduceClosureAssurance({ runId, checkpoint, events: input.events });
    const confirmation = reduceClosureAssurance({ runId, checkpoint, events: input.events });
    return {
      gauntletId: QUALITY_GAUNTLET_ID,
      runId,
      checkpoint,
      view,
      replayedEventCount: input.events.length,
      duplicateEventIds: view.duplicateEventIds,
      deterministic: view.viewDigest === confirmation.viewDigest
    };
  }
}

function buildEvents(
  request: QualityGauntletRequest,
  runId: string,
  checkpoint: string,
  resumed: boolean
): readonly QualityGauntletEvent[] {
  const occurredAt = text(request.requestedAt);
  const events: QualityGauntletEvent[] = [];
  if (!resumed) {
    events.push(createQualityGauntletEvent({ kind: 'assurance-started', runId, checkpoint, occurredAt }));
  }
  for (const obligation of request.obligations) {
    events.push(createQualityGauntletEvent({
      kind: 'obligation-observed',
      runId,
      checkpoint,
      occurredAt,
      obligationId: obligation.obligationId,
      semanticFamily: obligation.semanticFamily ?? null,
      owningSeam: obligation.owningSeam ?? null,
      outcome: obligation.excluded ? 'excluded' : null
    }));
  }
  for (const result of request.validatorResults) {
    for (const obligationId of result.obligationIds) {
      // A failing validator is a counterexample, not merely missing coverage:
      // it is the one outcome that blocks rather than leaves work open.
      events.push(createQualityGauntletEvent({
        kind: result.outcome === 'fail' ? 'counterexample-found' : 'validator-progress',
        runId,
        checkpoint,
        occurredAt,
        obligationId,
        validatorCommand: result.command,
        validatorCaseId: result.caseId ?? null,
        outcome: result.outcome,
        detail: result.detail ?? null
      }));
    }
  }
  if (request.stop === 'indeterminate') {
    events.push(createQualityGauntletEvent({
      kind: 'assurance-indeterminate',
      runId,
      checkpoint,
      occurredAt,
      detail: request.stopReason ?? null
    }));
  } else if (request.stop === 'stop') {
    events.push(createQualityGauntletEvent({
      kind: 'assurance-stopped',
      runId,
      checkpoint,
      occurredAt,
      detail: request.stopReason ?? null
    }));
  }
  return events;
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
