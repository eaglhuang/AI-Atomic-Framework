import { splitBehavior } from './split.ts';
import { mergeBehavior } from './merge.ts';
import { composeBehavior } from './compose.ts';
import { dedupMergeBehavior } from './dedup-merge.ts';
import { sweepBehavior } from './sweep.ts';
import { evolveBehavior } from './evolve.ts';
import { expireBehavior } from './expire.ts';
import { polymorphizeBehavior } from './polymorphize.ts';
import { infectBehavior } from './infect.ts';
import { atomizeBehavior } from './atomize.ts';
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

export const pluginBehaviorPackPackage = {
  packageName: '@ai-atomic-framework/plugin-behavior-pack',
  packageRole: 'consolidated-reference-behavior-pack',
  packageVersion: '0.0.0'
} as const;

export const behaviorPack: readonly AtomBehavior[] = Object.freeze([
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

export function registerBehaviorPack(registry: Pick<BehaviorRegistry, 'register'>): void {
  for (const behavior of behaviorPack) registry.register(behavior);
}

export default behaviorPack;
