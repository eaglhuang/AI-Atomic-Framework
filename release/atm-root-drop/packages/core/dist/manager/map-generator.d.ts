import { createMinimalAtomicMapSpec } from './map-generator/spec-support.ts';
import type { GenerateAtomicMapOptions, GenerateAtomicMapResult } from './map-generator/types.ts';
export type { GenerateAtomicMapResult };
export { createMinimalAtomicMapSpec };
export declare function generateAtomicMap(request: unknown, options?: GenerateAtomicMapOptions): GenerateAtomicMapResult;
