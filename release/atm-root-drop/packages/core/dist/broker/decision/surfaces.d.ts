import type { ActiveWriteIntent, WriteIntent } from '../types.ts';
export declare function hasSharedWriteSurface(intent: WriteIntent, active: ActiveWriteIntent): boolean;
export declare function hasIntersection(left: readonly string[], right: readonly string[]): boolean;
export declare function normalizeBrokerPath(value: string): string;
