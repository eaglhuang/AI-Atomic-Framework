export type DeepModuleTrigger =
  | 'repeated-bugs'
  | 'shotgun-changes'
  | 'duplicated-policy'
  | 'caller-complexity'
  | 'private-internal-tests'
  | 'missing-test-seam'
  | 'file-length';

export type DeepModuleDependencyClass =
  | 'in-process'
  | 'local-substitutable'
  | 'remote-owned'
  | 'true-external';

export interface DeepModuleRefactorCandidate {
  readonly moduleId: string;
  readonly sourcePaths: readonly string[];
  readonly ownerAtomOrMap: string;
  readonly publicInterface: string;
  readonly rollback: string;
  readonly causalValidators: readonly string[];
}

export interface DeepModuleObservedFriction {
  readonly triggers: readonly DeepModuleTrigger[];
  readonly evidenceRefs: readonly string[];
  readonly notes?: readonly string[];
}

export interface DeepModuleReviewProviderInput {
  readonly taskId: string;
  readonly candidate: DeepModuleRefactorCandidate;
  readonly observedFriction: DeepModuleObservedFriction;
  readonly dependencyClasses: readonly DeepModuleDependencyClass[];
  readonly proposedAdapters: readonly string[];
}

export type DeepModuleReviewStatus = 'pass' | 'follow-up-required' | 'blocked';

export interface DeepModuleReviewReport {
  readonly schemaId: 'atm.deepModuleReviewReport.v1';
  readonly providerContract: 'atm.deepModuleRefactorProvider.v1';
  readonly providerId: string;
  readonly providerVersion: string;
  readonly generatedAt: string;
  readonly taskId: string;
  readonly status: DeepModuleReviewStatus;
  readonly candidate: DeepModuleRefactorCandidate;
  readonly triggerVerdict: {
    readonly actionableTriggers: readonly DeepModuleTrigger[];
    readonly fileLengthAdvisoryOnly: boolean;
  };
  readonly seam: {
    readonly proposedInterface: string;
    readonly requiresTwoAdapters: boolean;
    readonly proposedAdapters: readonly string[];
    readonly deletionTest: string;
    readonly interfaceTest: string;
  };
  readonly hiddenComplexity: {
    readonly depth: 'low' | 'medium' | 'high';
    readonly leverage: string;
    readonly locality: string;
  };
  readonly dependencyClass: readonly DeepModuleDependencyClass[];
  readonly replaceDontLayerTest: string;
  readonly rollback: string;
  readonly causalValidators: readonly string[];
  readonly confidence: 'low' | 'medium' | 'high';
  readonly receiptFingerprint: string;
}

export const deepModuleProviderInfo = {
  providerId: 'matt-pocock-deep-module-reference',
  providerVersion: '2026-07-24.ed37663',
  providerContract: 'atm.deepModuleRefactorProvider.v1',
  upstreamUrl: 'https://github.com/mattpocock/skills',
  upstreamCommit: 'ed37663cc5fbef691ddfecd080dff42f7e7e350d',
  codebaseDesignDigest: 'sha256:c46b49303a81c7fc8934d0f4fbc44382cdecb73942d85d8d7db3523407fff8fa',
  improveArchitectureDigest: 'sha256:d3682058df92c259b47c36503baa02345d5811758621b5dc03081d5ba0f7b69b',
  license: 'MIT'
} as const;

const actionableTriggers: readonly DeepModuleTrigger[] = [
  'repeated-bugs',
  'shotgun-changes',
  'duplicated-policy',
  'caller-complexity',
  'private-internal-tests',
  'missing-test-seam'
];

const vocabulary = ['module', 'interface', 'seam', 'adapter', 'depth', 'leverage', 'locality'] as const;

export function createDeepModuleReviewReport(input: DeepModuleReviewProviderInput): DeepModuleReviewReport {
  const triggers = dedupe(input.observedFriction.triggers);
  const concreteTriggers = triggers.filter((trigger) => actionableTriggers.includes(trigger));
  const adapterCount = dedupe(input.proposedAdapters).length;
  const hasOnlyFileLength = concreteTriggers.length === 0 && triggers.includes('file-length');
  const hasRequiredAdapterEvidence = adapterCount >= 2;
  const status: DeepModuleReviewStatus = hasOnlyFileLength
    ? 'blocked'
    : hasRequiredAdapterEvidence
      ? 'pass'
      : 'follow-up-required';

  const report: Omit<DeepModuleReviewReport, 'receiptFingerprint'> = {
    schemaId: 'atm.deepModuleReviewReport.v1',
    providerContract: deepModuleProviderInfo.providerContract,
    providerId: deepModuleProviderInfo.providerId,
    providerVersion: deepModuleProviderInfo.providerVersion,
    generatedAt: new Date(0).toISOString(),
    taskId: input.taskId,
    status,
    candidate: {
      ...input.candidate,
      sourcePaths: dedupe(input.candidate.sourcePaths),
      causalValidators: dedupe(input.candidate.causalValidators)
    },
    triggerVerdict: {
      actionableTriggers: concreteTriggers,
      fileLengthAdvisoryOnly: true
    },
    seam: {
      proposedInterface: input.candidate.publicInterface,
      requiresTwoAdapters: true,
      proposedAdapters: dedupe(input.proposedAdapters),
      deletionTest: 'If this module is deleted, the policy and caller complexity must reappear across callers; otherwise the module is too shallow.',
      interfaceTest: 'Replace internals through the proposed interface and assert observable behavior through that interface only.'
    },
    hiddenComplexity: {
      depth: concreteTriggers.length >= 3 ? 'high' : 'medium',
      leverage: 'Concentrate repeated policy behind one interface so callers gain more behavior per fact learned.',
      locality: 'Keep fixes, rollback, and causal validator updates inside the owner atom or map.'
    },
    dependencyClass: dedupe(input.dependencyClasses),
    replaceDontLayerTest: 'Replace old private-internal tests with tests through the proposed interface once the adapters exist; do not layer tests over old shallow modules.',
    rollback: input.candidate.rollback,
    causalValidators: dedupe(input.candidate.causalValidators),
    confidence: status === 'pass' && concreteTriggers.length >= 2 ? 'high' : 'medium'
  };

  return {
    ...report,
    receiptFingerprint: createDeepModuleReviewFingerprint(report)
  };
}

export function createDeepModuleReviewFingerprint(report: Omit<DeepModuleReviewReport, 'receiptFingerprint'>): string {
  const stable = JSON.stringify({
    schemaId: report.schemaId,
    providerContract: report.providerContract,
    providerId: report.providerId,
    providerVersion: report.providerVersion,
    taskId: report.taskId,
    status: report.status,
    moduleId: report.candidate.moduleId,
    sourcePaths: report.candidate.sourcePaths,
    ownerAtomOrMap: report.candidate.ownerAtomOrMap,
    triggerVerdict: report.triggerVerdict,
    dependencyClass: report.dependencyClass,
    adapters: report.seam.proposedAdapters,
    rollback: report.rollback,
    causalValidators: report.causalValidators
  });
  let hash = 0;
  for (let index = 0; index < stable.length; index += 1) {
    hash = (hash * 31 + stable.charCodeAt(index)) >>> 0;
  }
  return `deep-module-review:${hash.toString(16).padStart(8, '0')}`;
}

export function deepModuleProviderVocabulary(): readonly string[] {
  return vocabulary;
}

function dedupe<T extends string>(items: readonly T[]): readonly T[] {
  return [...new Set(items.filter(Boolean))];
}
