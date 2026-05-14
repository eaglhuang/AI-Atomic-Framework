import { evaluateMutationGate, type GuidanceSession } from '../../core/src/guidance/index.ts';
import type { RegistryTransitionAction } from '@ai-atomic-framework/core';
import { EVOLVE_DELEGATION_TARGET, type AtomBehavior, type AtomBehaviorContext, type AtomBehaviorInput, type AtomBehaviorOutput } from './behavior.ts';

/**
 * BehaviorRegistry — central hub for registering and resolving AtomBehavior
 * plugin implementations.
 *
 * Design principle: core code never imports a concrete behavior. It only calls
 * BehaviorRegistry.resolve() / executeGuarded(), which look up behaviors at
 * runtime from the plugin-provided registry.
 *
 * The most important method here is executeGuarded():
 *   - If no behavior is registered for the requested action → ok:false with
 *     issue `behavior-not-found:<action>`.
 *   - If action is 'behavior.evolve' and the behavior returns ok:true but
 *     did NOT set delegatedTo === EVOLVE_DELEGATION_TARGET → the guard
 *     intercepts the result and returns ok:false with issue
 *     `evolve-must-delegate-to-propose-atomic-upgrade`.
 */
export class BehaviorRegistry {
  private readonly _behaviors = new Map<string, AtomBehavior>();

  /** Register a behavior implementation. Overwrites any prior registration with the same behaviorId. */
  register(behavior: AtomBehavior): void {
    this._behaviors.set(behavior.behaviorId, behavior);
  }

  /**
   * Find the first registered behavior whose actionCategories includes the
   * given action.  Returns null if none is registered.
   */
  resolve(action: RegistryTransitionAction): AtomBehavior | null {
    for (const behavior of this._behaviors.values()) {
      if ((behavior.actionCategories as readonly string[]).includes(action)) {
        return behavior;
      }
    }
    return null;
  }

  /** Like resolve(), but throws if no behavior is found. */
  resolveOrThrow(action: RegistryTransitionAction): AtomBehavior {
    const behavior = this.resolve(action);
    if (!behavior) {
      throw new Error(`No behavior registered for action: ${action}`);
    }
    return behavior;
  }

  /** Returns all registered behavior IDs. */
  listRegisteredBehaviorIds(): readonly string[] {
    return [...this._behaviors.keys()];
  }

  /** Returns all actions covered by at least one registered behavior. */
  listActions(): readonly RegistryTransitionAction[] {
    const actions = new Set<RegistryTransitionAction>();
    for (const behavior of this._behaviors.values()) {
      for (const action of behavior.actionCategories) {
        actions.add(action);
      }
    }
    return [...actions];
  }

  /**
   * Execute a behavior with the evolve delegation guard applied.
   *
   * Steps:
   * 1. Resolve a behavior for input.action. If none found → ok:false.
   * 2. Call behavior.execute().
   * 3. If action is 'behavior.evolve' AND output.ok is true AND
   *    output.delegatedTo !== EVOLVE_DELEGATION_TARGET → override to ok:false.
   */
  async executeGuarded(
    context: AtomBehaviorContext,
    input: AtomBehaviorInput
  ): Promise<AtomBehaviorOutput> {
    const behavior = this.resolve(input.action);
    if (!behavior) {
      return {
        ok: false,
        issues: [`behavior-not-found:${input.action}`],
        evidence: []
      };
    }

    const mutationGate = evaluateBehaviorMutationGate(input);
    if (!mutationGate.allowed) {
      return {
        ok: false,
        issues: mutationGate.issues.map((issue) => issue.code),
        evidence: mutationGate.issues.map((issue) => ({
          evidenceKind: 'validation',
          summary: issue.message,
          artifactPaths: [],
          details: issue.details
        }))
      };
    }

    const output = await behavior.execute(context, input);

    // Hard guard: behavior.evolve MUST delegate to ProposeAtomicUpgrade.
    // If the behavior claims ok:true but did not set the correct delegatedTo,
    // the registry rejects the result to prevent silent registry mutations.
    if (input.action === 'behavior.evolve' && output.ok) {
      if (output.delegatedTo !== EVOLVE_DELEGATION_TARGET) {
        return {
          ok: false,
          issues: ['evolve-must-delegate-to-propose-atomic-upgrade'],
          evidence: [],
          rollbackPlan: output.rollbackPlan
        };
      }
    }

    return output;
  }
}

function evaluateBehaviorMutationGate(input: AtomBehaviorInput) {
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  const hostMutationRequested = payload.hostMutationRequested === true
    || payload.applyRequested === true
    || payload.promoteRequested === true
    || payload.requireGuidanceGate === true
    || payload.unguided === true;
  if (!hostMutationRequested) {
    return { allowed: true, advisory: false, auditRequired: false, issues: [] };
  }
  const activeSession = payload.activeGuidanceSession && typeof payload.activeGuidanceSession === 'object'
    ? payload.activeGuidanceSession as GuidanceSession
    : null;
  const releaseBlockers = Array.isArray(payload.releaseBlockers)
    ? payload.releaseBlockers.map((entry) => String(entry))
    : [];
  const targetSegmentRole = payload.targetSegmentRole === 'trunk'
    || payload.targetSegmentRole === 'leaf'
    || payload.targetSegmentRole === 'adapter-boundary'
    ? payload.targetSegmentRole
    : 'unknown';
  const profile = payload.profile === 'ci' || payload.profile === 'release' ? payload.profile : 'dev';
  return evaluateMutationGate({
    action: input.action,
    profile,
    activeSession,
    isLegacyTarget: payload.isLegacyTarget === true || typeof payload.legacySource === 'string',
    hasLegacyRoutePlan: payload.hasLegacyRoutePlan === true || Boolean(payload.legacyRoutePlan),
    hasDryRunProposal: payload.hasDryRunProposal === true || Boolean(payload.dryRunProposal),
    applyRequested: payload.applyRequested === true,
    promoteRequested: payload.promoteRequested === true,
    reviewApproved: payload.reviewApproved === true,
    releaseBlockers,
    targetSegmentRole,
    unguided: payload.unguided === true,
    unguidedReason: typeof payload.unguidedReason === 'string' ? payload.unguidedReason : null
  });
}
