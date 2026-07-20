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
export type AtomCandidateKind = 'function' | 'class' | 'module' | 'route' | 'command' | 'schema' | 'unknown';
export type AtomCandidateConfidence = 'high' | 'medium' | 'low';
export type AtomCandidateDetectionMethod = 'regex' | 'scanner' | 'compiler-api' | 'ast' | 'lsp' | 'llm-assisted';
export type EnclosingUnitKind = 'function' | 'var-decl' | 'statement' | 'class-method' | 'unknown';
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
    discoverAtomCandidates(request: AtomCandidateDiscoveryRequest): Promise<readonly AtomCandidate[]> | readonly AtomCandidate[];
    planAtomize(request: AtomizationPlanRequest): Promise<AtomizationPlan> | AtomizationPlan;
    enclose?(file: string, line: number): EnclosingUnit | null;
}
export declare function isEnclosingUnit(value: unknown): value is EnclosingUnit;
export declare function isVirtualAtom(value: unknown): value is VirtualAtom;
/**
 * Runtime schema guard for `AtomCandidate`, usable by adapters and tests to
 * validate candidate shapes crossing plugin boundaries.
 */
export declare function isAtomCandidate(value: unknown): value is AtomCandidate;
/**
 * Runtime schema guard for `AtomizationPlan` dry-run envelopes.
 */
export declare function isAtomizationPlan(value: unknown): value is AtomizationPlan;
