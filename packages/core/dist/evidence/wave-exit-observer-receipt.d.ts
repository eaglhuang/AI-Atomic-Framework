export { digestWaveExitObserverInput, digestWaveExitObserverInputsAtCommit } from './wave-exit-observer-input-digest.js';
export declare const WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID: "atm.waveExitObserverReceipt.v1";
export declare const WAVE_EXIT_OBSERVER_POLICY_SCHEMA_ID: "atm.waveExitObserverPolicy.v1";
export declare const WAVE_EXIT_OBSERVER_POLICY_PATH = "schemas/evidence/wave-exit-observer-policy.json";
export declare const WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_PATH = "schemas/evidence/wave-exit-observer-receipt.schema.json";
export declare const CANONICAL_WAVE_EXIT_RECEIPT_DIR = "docs/reports/wave-exit-observer-receipts";
export type WaveExitObserverDiagnostic = 'missing-field' | 'schema-mismatch' | 'unapproved-command' | 'compiler-command-forbidden' | 'observer-basis-actor-conflict' | 'declared-basis-actor-mismatch' | 'observer-role-mismatch' | 'target-head-unreachable' | 'receipt-stale' | 'historical-policy-invalid' | 'input-digest-drift' | 'basis-actor-unresolved' | 'wave-mismatch' | 'exit-unmapped' | 'nonzero-exit' | 'artifact-path-mismatch' | 'independence-verdict-invalid';
export interface WaveExitObserverInputDigest {
    readonly path: string;
    readonly digest: string;
}
export interface WaveExitObserverReceipt {
    readonly schemaId: typeof WAVE_EXIT_OBSERVER_RECEIPT_SCHEMA_ID;
    readonly schemaVersion: string;
    readonly exitItemId: string;
    readonly wave: string;
    readonly observerActor: string;
    readonly observerRole: string;
    readonly declaredBasisActor: string;
    readonly independenceVerdict: 'independent';
    readonly command: string;
    readonly exitCode: number;
    readonly stdoutDigest: string;
    readonly stderrDigest: string;
    readonly observedAt: string;
    readonly observedHead: string;
    readonly policyDigest: string;
    readonly inputDigests: readonly WaveExitObserverInputDigest[];
    readonly artifactPath: string;
}
export interface WaveExitObserverRole {
    readonly kind: 'basis' | 'observer' | 'not-observer';
    readonly executor?: string;
}
export interface WaveExitObserverExitPolicy {
    readonly wave: string;
    readonly observerRole: string;
    readonly command: string;
    readonly commandPath: string;
    readonly inputs: readonly string[];
    /**
     * A sealed, policy-owned projection for an input that is also rewritten by
     * the compiler which consumes this receipt.  The projection preserves every
     * other exit and requirement while excluding this exit's derived envelope.
     */
    readonly inputDigestProjection?: 'completion-report-excluding-current-exit' | 'objective-audit-excluding-certificate-result' | 'objective-audit-excluding-derived-conclusion';
    readonly sideEffects: string;
    readonly forbiddenFlags: readonly string[];
}
export type WaveExitBasisActorResolution = 'active-claim-holder' | 'unique-evidence-actor';
export interface WaveExitObserverPolicyDigestSpec {
    readonly encoding: 'utf8';
    readonly newline: 'lf';
    readonly source: 'git-show';
    readonly path: typeof WAVE_EXIT_OBSERVER_POLICY_PATH;
}
export interface WaveExitObserverPolicy {
    readonly schemaId: typeof WAVE_EXIT_OBSERVER_POLICY_SCHEMA_ID;
    readonly specVersion: string;
    readonly canonicalReceiptDir: string;
    readonly compilerCommandPath: string;
    readonly basisProducerRole: string;
    readonly basisEvidenceOwners: readonly string[];
    readonly basisActorResolution: WaveExitBasisActorResolution;
    readonly policyDigest: WaveExitObserverPolicyDigestSpec;
    readonly roles: Readonly<Record<string, WaveExitObserverRole>>;
    readonly exits: Readonly<Record<string, WaveExitObserverExitPolicy>>;
}
export interface DerivedBasisIdentity {
    readonly actorIds: readonly string[];
    readonly producerRole: string;
}
export interface ConsumeWaveExitObserverReceiptInput {
    readonly receipt: unknown;
    readonly policy: WaveExitObserverPolicy;
    readonly compilationHead: string;
    readonly derivedBasis: DerivedBasisIdentity;
    readonly currentInputDigests: Readonly<Record<string, string>>;
    readonly isAncestor: (ancestor: string, descendant: string) => boolean;
    readonly policyDigestAtCompilationHead: string;
    readonly readPolicySourceAtCommit: (commit: string) => string | null;
}
export interface WaveExitObserverVerdict {
    readonly ok: boolean;
    readonly status: 'proven' | 'unproven';
    readonly diagnostics: readonly WaveExitObserverDiagnostic[];
    readonly receipt: WaveExitObserverReceipt | null;
    readonly canonicalArtifactPath: string | null;
}
export interface ConsumeWaveExitObserverReceiptCandidatesInput {
    readonly repoRoot: string;
    readonly receipts: readonly unknown[];
    readonly policy: WaveExitObserverPolicy;
    readonly compilationHead: string;
    readonly currentInputDigests: Readonly<Record<string, string>>;
    readonly policyDigestAtCompilationHead: string;
    readonly isAncestor: (ancestor: string, descendant: string) => boolean;
    readonly basisActors?: readonly string[];
    readonly readPolicySourceAtCommit?: (commit: string) => string | null;
}
export interface WaveExitObserverCandidatesVerdict {
    readonly receipt: WaveExitObserverReceipt | null;
    readonly diagnostics: readonly (WaveExitObserverDiagnostic | 'receipt-ambiguity')[];
}
export declare function digestText(value: string): string;
export declare function normalizeWaveExitObserverPolicySource(source: string): string;
export declare function digestWaveExitObserverPolicySource(source: string): string;
export declare function readWaveExitObserverPolicySource(repoRoot?: string): string;
/** Compact JSON.stringify(policy) is not the sealed digest. Observers must hash git-show bytes. */
export declare function digestWaveExitObserverPolicy(policy: WaveExitObserverPolicy, source?: string): string;
export declare function loadWaveExitObserverPolicy(repoRoot?: string): WaveExitObserverPolicy;
/**
 * Consumers that replay a sealed completion report must resolve the policy
 * from the report's target commit, rather than from whatever happens to be in
 * the live working tree.  A missing or malformed historical policy remains an
 * explicit failure for the caller to handle.
 */
export declare function loadWaveExitObserverPolicyAtCommit(repoRoot: string, commit: string): WaveExitObserverPolicy | null;
export declare function readWaveExitObserverPolicySourceAtCommit(repoRoot: string, commit: string): string | null;
export declare function readClaimHolderActor(repoRoot: string, taskId: string): string | null;
export declare function readEvidenceProducerActors(repoRoot: string, taskId: string): string[];
/**
 * A receipt is an observation of a particular repository state.  Resolving a
 * basis actor against the current ledger would let a later handoff invalidate
 * an otherwise immutable observation, so receipt consumers read the task
 * authority snapshot from the observed commit instead.
 */
export declare function readClaimHolderActorAtCommit(repoRoot: string, taskId: string, commit: string): string | null;
export declare function resolveWaveExitBasisProducer(input: {
    readonly repoRoot: string;
    readonly policy: WaveExitObserverPolicy;
    /** The immutable observation commit when consuming a historical receipt. */
    readonly basisCommit?: string;
    readonly readClaimHolder?: (taskId: string) => string | null;
    readonly readClaimHolderAtCommit?: (taskId: string, commit: string) => string | null;
    readonly readEvidenceActors?: (taskId: string) => readonly string[];
}): DerivedBasisIdentity;
export declare function canonicalWaveExitReceiptPath(policy: WaveExitObserverPolicy, exitItemId: string, observedHead?: string): string;
export declare function deriveBasisIdentityFromEvidence(input: {
    readonly producerActors: readonly string[];
    readonly producerRole: string;
}): DerivedBasisIdentity;
export declare function consumeWaveExitObserverReceipt(input: ConsumeWaveExitObserverReceiptInput): WaveExitObserverVerdict;
/**
 * Resolve immutable receipts for one EXIT.  A later valid observation supersedes
 * an earlier valid observation only when its observed HEAD is a strict descendant.
 * Divergent observations (or duplicate observations at one HEAD) remain ambiguous.
 */
export declare function consumeWaveExitObserverReceiptCandidates(input: ConsumeWaveExitObserverReceiptCandidatesInput): WaveExitObserverCandidatesVerdict;
export declare function readCanonicalWaveExitReceipt(repoRoot: string, policy: WaveExitObserverPolicy, exitItemId: string): unknown | null;
/**
 * A receipt never overwrites an earlier observation.  When an input changes,
 * a successor is stored under the EXIT id and observed commit; consumers
 * evaluate every immutable candidate and accept only a unique valid one.
 */
export declare function readWaveExitReceiptCandidates(repoRoot: string, policy: WaveExitObserverPolicy, exitItemId: string): unknown[];
