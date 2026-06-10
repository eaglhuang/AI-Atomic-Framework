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
