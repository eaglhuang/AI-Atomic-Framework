import type { AtomBehavior, BehaviorRegistry } from '@ai-atomic-framework/plugin-sdk';
export { splitBehavior } from './split.js';
export { mergeBehavior } from './merge.js';
export { composeBehavior } from './compose.js';
export { dedupMergeBehavior } from './dedup-merge.js';
export { sweepBehavior } from './sweep.js';
export { evolveBehavior } from './evolve.js';
export { expireBehavior } from './expire.js';
export { polymorphizeBehavior } from './polymorphize.js';
export { infectBehavior } from './infect.js';
export { atomizeBehavior } from './atomize.js';
export declare const pluginBehaviorPackPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-behavior-pack";
    readonly packageRole: "consolidated-reference-behavior-pack";
    readonly packageVersion: "0.0.0";
};
export declare const behaviorPack: readonly AtomBehavior[];
export declare function registerBehaviorPack(registry: Pick<BehaviorRegistry, 'register'>): void;
export default behaviorPack;
