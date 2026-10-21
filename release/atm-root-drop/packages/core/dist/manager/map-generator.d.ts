import { createMinimalAtomicMapSpec } from './map-generator/spec-support.js';
import type { GenerateAtomicMapOptions, GenerateAtomicMapResult } from './map-generator/types.js';
export type { GenerateAtomicMapResult };
export { createMinimalAtomicMapSpec };
export declare function generateAtomicMap(request: unknown, options?: GenerateAtomicMapOptions): GenerateAtomicMapResult;
