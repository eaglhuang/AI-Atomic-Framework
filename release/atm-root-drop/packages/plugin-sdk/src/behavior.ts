import type { EvidenceRecord, RegistryEntryStatus, RegistryGovernanceTier, RegistryTransitionAction } from '@ai-atomic-framework/core';

/**
 * The only valid delegation target for behavior.evolve.
 * An evolve behavior MUST delegate to ProposeAtomicUpgrade and MUST NOT
 * directly mutate the registry or bypass the human-review gate (ATM-2-0021).
 */
export const EVOLVE_DELEGATION_TARGET = 'ATM-2-0020:ProposeAtomicUpgrade' as const;

export type EvolveDelegationTarget = typeof EVOLVE_DELEGATION_TARGET;

/** Execution context passed to every behavior invocation. */
export interface AtomBehaviorContext {
  readonly repositoryRoot: string;
  readonly actor?: string;
  readonly startedAt?: string;
  readonly traceId?: string;
}

/** Input contract for a single behavior execution. */
export interface AtomBehaviorInput {
  readonly entryType: 'atom' | 'map';
  readonly atomId?: string;
  readonly mapId?: string;
  readonly action: RegistryTransitionAction;
  readonly requestedBy: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * Describes the registry state transition that a behavior plans to produce.
 * This is a declarative plan — it does NOT directly write to the registry.
 * The actual registry mutation must go through the governance flow.
 */
export interface AtomBehaviorRegistryTransition {
  readonly fromStatus: RegistryEntryStatus;
  readonly toStatus: RegistryEntryStatus;
  readonly governanceTier: RegistryGovernanceTier;
  readonly notes: string;
}

/** Rollback instructions emitted by a behavior when things go wrong. */
export interface AtomBehaviorRollbackPlan {
  readonly steps: readonly string[];
  readonly rollbackCommand?: string;
  readonly timeoutMs?: number;
}

/**
 * Output contract returned by every behavior execution.
 *
 * For behavior.evolve: `ok` MUST be true only when `delegatedTo` is
 * exactly `EVOLVE_DELEGATION_TARGET`. BehaviorRegistry.executeGuarded()
 * enforces this — if the behavior returns ok:true without the correct
 * delegatedTo, the guard flips ok to false and emits
 * 'evolve-must-delegate-to-propose-atomic-upgrade'.
 */
export interface AtomBehaviorOutput {
  readonly ok: boolean;
  readonly delegatedTo?: EvolveDelegationTarget | string;
  readonly registryTransition?: AtomBehaviorRegistryTransition;
  readonly rollbackPlan?: AtomBehaviorRollbackPlan;
  readonly issues: readonly string[];
  readonly evidence: readonly EvidenceRecord[];
}

/**
 * The AtomBehavior interface — the single contract every behavior plugin
 * must implement. Core only depends on this interface; concrete implementations
 * live in plugins, never in core.
 */
export interface AtomBehavior {
  /** Stable identifier, e.g. 'builtin-split-behavior'. */
  readonly behaviorId: string;
  /** The transition actions this behavior handles. */
  readonly actionCategories: readonly RegistryTransitionAction[];
  execute(
    context: AtomBehaviorContext,
    input: AtomBehaviorInput
  ): Promise<AtomBehaviorOutput> | AtomBehaviorOutput;
}
