import type { ArtifactRecord, EvidenceRecord } from '@ai-atomic-framework/core';
import type { AtomLifecycleModeValue } from './lifecycle';

export type PoliceLifecycleMode = AtomLifecycleModeValue;

export type PoliceSeverity = 'info' | 'warning' | 'error';

export type PoliceCheckKind =
  | 'schema'
  | 'dependency-graph'
  | 'layer-boundary'
  | 'forbidden-import'
  | 'registry-consistency'
  | 'atomic-map-integration';

export interface PoliceViolation {
  readonly code: string;
  readonly severity: PoliceSeverity;
  readonly message: string;
  readonly path?: string;
  readonly atomId?: string;
}

export interface PoliceCheckContract {
  readonly checkId: string;
  readonly kind: PoliceCheckKind;
  readonly required: boolean;
  readonly description: string;
}

export interface PoliceCheckResult extends PoliceCheckContract {
  readonly ok: boolean;
  readonly violations: readonly PoliceViolation[];
}

export interface PoliceReport {
  readonly schemaId: 'atm.policeReport';
  readonly specVersion: '0.1.0';
  readonly lifecycleMode: PoliceLifecycleMode;
  readonly ok: boolean;
  readonly canPromote: boolean;
  readonly checks: readonly PoliceCheckResult[];
  readonly violations: readonly PoliceViolation[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly evidence: readonly EvidenceRecord[];
}
