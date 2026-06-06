import { splitBehavior } from './split.js';
import { mergeBehavior } from './merge.js';
import { composeBehavior } from './compose.js';
import { dedupMergeBehavior } from './dedup-merge.js';
import { sweepBehavior } from './sweep.js';
import { evolveBehavior } from './evolve.js';
import { expireBehavior } from './expire.js';
import { polymorphizeBehavior } from './polymorphize.js';
import { infectBehavior } from './infect.js';
import { atomizeBehavior } from './atomize.js';
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
export const pluginBehaviorPackPackage = {
    packageName: '@ai-atomic-framework/plugin-behavior-pack',
    packageRole: 'consolidated-reference-behavior-pack',
    packageVersion: '0.0.0'
};
export const behaviorPack = Object.freeze([
    splitBehavior,
    mergeBehavior,
    composeBehavior,
    dedupMergeBehavior,
    sweepBehavior,
    evolveBehavior,
    expireBehavior,
    polymorphizeBehavior,
    infectBehavior,
    atomizeBehavior
]);
export function registerBehaviorPack(registry) {
    for (const behavior of behaviorPack)
        registry.register(behavior);
}
export default behaviorPack;
