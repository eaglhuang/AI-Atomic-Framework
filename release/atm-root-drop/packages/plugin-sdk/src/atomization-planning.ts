import type { LanguageAdapterMessage, LanguageSourceFile } from './language-adapter';

/**
 * Optional atomization-planning SDK contract.
 *
 * Language adapters MAY implement `AtomizationPlanningAdapter` to expose
 * atom candidates and dry-run atomization plans to ATM core. The contract is
 * additive: adapters that only implement `LanguageAdapter` remain valid.
 *
 * Detection method is intentionally open: regex, line scanner, compiler API,
 * AST, LSP, or LLM-assisted detection are all acceptable. None is mandatory.
 */

export type AtomCandidateKind =
  | 'function'
  | 'class'
  | 'module'
  | 'route'
  | 'command'
  | 'schema'
  | 'unknown';

export type AtomCandidateConfidence = 'high' | 'medium' | 'low';

export type AtomCandidateDetectionMethod =
  | 'regex'
  | 'scanner'
  | 'compiler-api'
  | 'ast'
  | 'lsp'
  | 'llm-assisted';

export type EnclosingUnitKind =
  | 'function'
  | 'var-decl'
  | 'statement'
  | 'class-method'
  | 'unknown';

export type EnclosingUnitConfidenceClass = AtomCandidateConfidence;

export type VirtualAtomDetectionMethod = 'agr-layer1' | 'agr-layer2';

export type VirtualAtomLayer = 1 | 2;

export interface EnclosingUnitFileRange {
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface EnclosingUnit {
  readonly kind: EnclosingUnitKind;
  readonly symbol: string;
  readonly fileRange: EnclosingUnitFileRange;
  readonly confidenceClass: EnclosingUnitConfidenceClass;
}

export interface VirtualAtom {
  readonly kind: EnclosingUnitKind;
  readonly symbol: string;
  readonly sourcePaths: readonly string[];
  readonly detectionMethod: VirtualAtomDetectionMethod;
  readonly layer: VirtualAtomLayer;
  readonly confidenceClass: EnclosingUnitConfidenceClass;
  readonly atomCid: string;
}

export interface AtomCandidate {
  readonly candidateId: string;
  readonly kind: AtomCandidateKind;
  readonly symbol: string;
  readonly filePath: string;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly confidence: AtomCandidateConfidence;
  readonly detectionMethod: AtomCandidateDetectionMethod;
  readonly suggestedAtomId?: string;
  readonly suggestedSourcePaths?: readonly string[];
  readonly notes?: readonly string[];
}

export interface AtomCandidateDiscoveryFilters {
  readonly kinds?: readonly AtomCandidateKind[];
  readonly minConfidence?: AtomCandidateConfidence;
  readonly filePathPrefixes?: readonly string[];
}

export interface AtomCandidateDiscoveryRequest {
  readonly sourceFiles: readonly LanguageSourceFile[];
  readonly filters?: AtomCandidateDiscoveryFilters;
}

export interface AtomizationPlanRequest {
  readonly atomId: string;
  readonly target: AtomCandidate;
  readonly sourceFiles: readonly LanguageSourceFile[];
  readonly dryRun: true;
}

export interface AtomizationPlanStep {
  readonly stepKind: string;
  readonly description: string;
  readonly patchHint?: string;
}

export interface AtomizationPlan {
  readonly atomId: string;
  readonly dryRun: true;
  readonly target: AtomCandidate;
  readonly patchFiles: readonly string[];
  readonly steps: readonly AtomizationPlanStep[];
  readonly evidenceRequired: readonly string[];
  readonly rollbackNotes: string;
  readonly messages: readonly LanguageAdapterMessage[];
}

/**
 * Optional capability interface. Adapters implement this in addition to
 * `LanguageAdapter`; ATM core feature-detects it before use.
 */
export interface AtomizationPlanningAdapter {
  discoverAtomCandidates(
    request: AtomCandidateDiscoveryRequest
  ): Promise<readonly AtomCandidate[]> | readonly AtomCandidate[];
  planAtomize(request: AtomizationPlanRequest): Promise<AtomizationPlan> | AtomizationPlan;
  enclose?(file: string, line: number): EnclosingUnit | null;
}

const atomCandidateKinds: readonly AtomCandidateKind[] = [
  'function',
  'class',
  'module',
  'route',
  'command',
  'schema',
  'unknown'
];

const atomCandidateConfidences: readonly AtomCandidateConfidence[] = ['high', 'medium', 'low'];

const atomCandidateDetectionMethods: readonly AtomCandidateDetectionMethod[] = [
  'regex',
  'scanner',
  'compiler-api',
  'ast',
  'lsp',
  'llm-assisted'
];

const enclosingUnitKinds: readonly EnclosingUnitKind[] = [
  'function',
  'var-decl',
  'statement',
  'class-method',
  'unknown'
];

const virtualAtomDetectionMethods: readonly VirtualAtomDetectionMethod[] = ['agr-layer1', 'agr-layer2'];

const virtualAtomLayers: readonly VirtualAtomLayer[] = [1, 2];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFileRange(value: unknown): value is EnclosingUnitFileRange {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.file)) return false;
  if (typeof record.lineStart !== 'number' || typeof record.lineEnd !== 'number') return false;
  if (!Number.isFinite(record.lineStart) || !Number.isFinite(record.lineEnd)) return false;
  if (record.lineStart < 1 || record.lineEnd < record.lineStart) return false;
  return true;
}

export function isEnclosingUnit(value: unknown): value is EnclosingUnit {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!enclosingUnitKinds.includes(record.kind as EnclosingUnitKind)) return false;
  if (!isNonEmptyString(record.symbol)) return false;
  if (!isFileRange(record.fileRange)) return false;
  if (!atomCandidateConfidences.includes(record.confidenceClass as EnclosingUnitConfidenceClass)) {
    return false;
  }
  return true;
}

export function isVirtualAtom(value: unknown): value is VirtualAtom {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!enclosingUnitKinds.includes(record.kind as EnclosingUnitKind)) return false;
  if (!isNonEmptyString(record.symbol)) return false;
  if (
    !Array.isArray(record.sourcePaths)
    || record.sourcePaths.length === 0
    || record.sourcePaths.some((entry) => !isNonEmptyString(entry))
  ) {
    return false;
  }
  if (!virtualAtomDetectionMethods.includes(record.detectionMethod as VirtualAtomDetectionMethod)) {
    return false;
  }
  if (!virtualAtomLayers.includes(record.layer as VirtualAtomLayer)) return false;
  if (!atomCandidateConfidences.includes(record.confidenceClass as EnclosingUnitConfidenceClass)) {
    return false;
  }
  if (!isNonEmptyString(record.atomCid)) return false;
  return true;
}

/**
 * Runtime schema guard for `AtomCandidate`, usable by adapters and tests to
 * validate candidate shapes crossing plugin boundaries.
 */
export function isAtomCandidate(value: unknown): value is AtomCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.candidateId !== 'string' || record.candidateId.length === 0) return false;
  if (!atomCandidateKinds.includes(record.kind as AtomCandidateKind)) return false;
  if (typeof record.symbol !== 'string') return false;
  if (typeof record.filePath !== 'string' || record.filePath.length === 0) return false;
  if (record.lineStart !== null && typeof record.lineStart !== 'number') return false;
  if (record.lineEnd !== null && typeof record.lineEnd !== 'number') return false;
  if (!atomCandidateConfidences.includes(record.confidence as AtomCandidateConfidence)) return false;
  if (!atomCandidateDetectionMethods.includes(record.detectionMethod as AtomCandidateDetectionMethod)) {
    return false;
  }
  if (record.suggestedAtomId !== undefined && typeof record.suggestedAtomId !== 'string') return false;
  if (
    record.suggestedSourcePaths !== undefined
    && (!Array.isArray(record.suggestedSourcePaths)
      || record.suggestedSourcePaths.some((entry) => typeof entry !== 'string'))
  ) {
    return false;
  }
  if (
    record.notes !== undefined
    && (!Array.isArray(record.notes) || record.notes.some((entry) => typeof entry !== 'string'))
  ) {
    return false;
  }
  return true;
}

/**
 * Runtime schema guard for `AtomizationPlan` dry-run envelopes.
 */
export function isAtomizationPlan(value: unknown): value is AtomizationPlan {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.atomId !== 'string' || record.atomId.length === 0) return false;
  if (record.dryRun !== true) return false;
  if (!isAtomCandidate(record.target)) return false;
  if (!Array.isArray(record.patchFiles) || record.patchFiles.some((entry) => typeof entry !== 'string')) {
    return false;
  }
  if (
    !Array.isArray(record.steps)
    || record.steps.some((step) => {
      if (typeof step !== 'object' || step === null) return true;
      const stepRecord = step as Record<string, unknown>;
      return typeof stepRecord.stepKind !== 'string' || typeof stepRecord.description !== 'string';
    })
  ) {
    return false;
  }
  if (
    !Array.isArray(record.evidenceRequired)
    || record.evidenceRequired.some((entry) => typeof entry !== 'string')
  ) {
    return false;
  }
  if (typeof record.rollbackNotes !== 'string') return false;
  if (!Array.isArray(record.messages)) return false;
  return true;
}
