import type { AtomBehavior, BehaviorRegistry } from '@ai-atomic-framework/plugin-sdk';
export { splitBehavior } from './split.ts';
export { mergeBehavior } from './merge.ts';
export { composeBehavior } from './compose.ts';
export { dedupMergeBehavior } from './dedup-merge.ts';
export { sweepBehavior } from './sweep.ts';
export { evolveBehavior } from './evolve.ts';
export { expireBehavior } from './expire.ts';
export { polymorphizeBehavior } from './polymorphize.ts';
export { infectBehavior } from './infect.ts';
export { atomizeBehavior } from './atomize.ts';
export declare const pluginBehaviorPackPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-behavior-pack";
    readonly packageRole: "consolidated-reference-behavior-pack";
    readonly packageVersion: "0.0.0";
};
export declare const behaviorPack: readonly AtomBehavior[];
export declare function registerBehaviorPack(registry: Pick<BehaviorRegistry, 'register'>): void;
export default behaviorPack;
