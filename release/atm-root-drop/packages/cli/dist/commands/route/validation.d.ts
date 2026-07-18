import type { RouteResourceSet } from '../../../../core/src/routing/index.ts';
import type { RouteContextValidation } from './types.ts';
export declare function parseResourceSet(input: string[]): RouteResourceSet;
export declare function validateRouteContext(value: unknown): RouteContextValidation;
