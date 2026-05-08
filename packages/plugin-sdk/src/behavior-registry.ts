import type { RegistryTransitionAction } from '@ai-atomic-framework/core';
import type { AtomBehavior, AtomBehaviorContext, AtomBehaviorInput, AtomBehaviorOutput } from './behavior.ts';
import { EVOLVE_DELEGATION_TARGET } from './behavior.ts';

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
