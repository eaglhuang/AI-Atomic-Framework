import { type FileMutationAdapter } from '../types.ts';
export declare const NUMERIC_SCALAR_ADAPTER_ID = "numeric-scalar";
/** Numeric scalar operations this adapter understands. */
export type NumericScalarOp = 'increment' | 'decrement' | 'max' | 'min' | 'set-if-current';
/**
 * Numeric scalar adapter (TASK-CID-0096). Files hold a flat map of
 * scalarKey -> number. increment/decrement are commutative (net delta applied);
 * max/min are commutative among themselves; set-if-current is NOT commutative
 * and conflicts with anything else on the same scalar. Scope is 'scalar'.
 */
export declare const numericScalarAdapter: FileMutationAdapter;
