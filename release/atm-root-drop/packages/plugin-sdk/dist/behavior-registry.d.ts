import type { RegistryTransitionAction } from '@ai-atomic-framework/core';
import { type AtomBehavior, type AtomBehaviorContext, type AtomBehaviorInput, type AtomBehaviorOutput } from './behavior.ts';
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
export declare class BehaviorRegistry {
    private readonly _behaviors;
    /** Register a behavior implementation. Overwrites any prior registration with the same behaviorId. */
    register(behavior: AtomBehavior): void;
    /**
     * Find the first registered behavior whose actionCategories includes the
     * given action.  Returns null if none is registered.
     */
    resolve(action: RegistryTransitionAction): AtomBehavior | null;
    /** Like resolve(), but throws if no behavior is found. */
    resolveOrThrow(action: RegistryTransitionAction): AtomBehavior;
    /** Returns all registered behavior IDs. */
    listRegisteredBehaviorIds(): readonly string[];
    /** Returns all actions covered by at least one registered behavior. */
    listActions(): readonly RegistryTransitionAction[];
    /**
     * Execute a behavior with the evolve delegation guard applied.
     *
     * Steps:
     * 1. Resolve a behavior for input.action. If none found → ok:false.
     * 2. Call behavior.execute().
     * 3. If action is 'behavior.evolve' AND output.ok is true AND
     *    output.delegatedTo !== EVOLVE_DELEGATION_TARGET → override to ok:false.
     */
    executeGuarded(context: AtomBehaviorContext, input: AtomBehaviorInput): Promise<AtomBehaviorOutput>;
}
