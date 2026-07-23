/**
 * Semantic revalidation contracts for publish-intent read/write algebra.
 * Post-compose / pre-steward command-backed validation lives in
 * `post-compose-semantic-validation-policy.ts` and reuses these validator ref
 * shapes without introducing a second merge engine or validator registry.
 */
import type { MigrationRecord } from './types.ts';

export type SemanticOperationKind = 'create' | 'modify' | 'delete' | 'rename' | 'scalar';
export type SemanticOperationAlgebra = 'commutative' | 'noncommutative' | 'unknown';
export type SemanticResourceDomain = 'code' | 'docs' | 'planning' | 'private';
export type SemanticRevalidationVerdict =
  | 'valid'
  | 'recompute-required'
  | 'queue-required'
  | 'steward-required'
  | 'inconclusive';
export type SemanticTicketNextAction =
  | 'publish'
  | 'recompute'
  | 'queue'
  | 'steward-review'
  | 'keep-read-lane';

export interface SemanticDigestSet {
  readonly baseDigest: string;
  readonly currentDigest: string;
  readonly publishedSetDigest: string;
}

export interface SemanticReadObservation {
  readonly atomId: string;
  readonly atomCid: string;
  readonly anchorId?: string;
  readonly filePath: string;
  readonly digest: string;
  readonly provenance: readonly string[];
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface SemanticWriteFact {
  readonly atomId: string;
  readonly atomCid: string;
  readonly anchorId?: string;
  readonly filePath: string;
  readonly operation: SemanticOperationKind;
  readonly algebra: SemanticOperationAlgebra;
  readonly preconditions?: readonly string[];
  readonly postconditions?: readonly string[];
}

export interface SemanticValidatorRef {
  readonly command: string;
  readonly available: boolean;
  readonly result?: 'pass' | 'fail' | 'not-run';
}

export interface SemanticRevalidationRequest {
  readonly schemaId: 'atm.semanticRevalidationRequest.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly requestId: string;
  readonly taskId: string;
  readonly domain: SemanticResourceDomain;
  readonly publishIntent: boolean;
  readonly digests: SemanticDigestSet;
  readonly readSet: readonly SemanticReadObservation[];
  readonly publishedWriteSet: readonly SemanticWriteFact[];
  readonly assumptions: readonly string[];
  readonly validators: readonly SemanticValidatorRef[];
}

export interface SemanticRevalidationResult {
  readonly schemaId: 'atm.semanticRevalidationResult.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly requestId: string;
  readonly taskId: string;
  readonly domain: SemanticResourceDomain;
  readonly verdict: SemanticRevalidationVerdict;
  readonly ticketNextAction: SemanticTicketNextAction;
  readonly digests: SemanticDigestSet;
  readonly assumptions: readonly string[];
  readonly validatorRefs: readonly SemanticValidatorRef[];
  readonly reasons: readonly string[];
  readonly staleReadAnchors: readonly string[];
  readonly operationConflicts: readonly string[];
}
