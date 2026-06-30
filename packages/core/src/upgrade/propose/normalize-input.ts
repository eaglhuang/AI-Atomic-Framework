/**
 * normalize-input.ts
 *
 * TASK-ASR-0012 — propose.ts 完整拆分
 *
 * Input 規範化相關函式：把外部傳入的 upgrade proposal inputs 轉成
 * 標準化的內部格式，供 proposeAtomicUpgrade 使用。
 */

export const INPUT_KIND_PRIORITY = new Map([
  ['hash-diff', 0],
  ['execution-evidence', 1],
  ['non-regression', 2],
  ['quality-comparison', 3],
  ['registry-candidate', 4],
  ['map-equivalence', 5],
  ['polymorph-impact', 6],
  ['propagation-report', 7],
  ['review-advisory', 8],
  ['human-review', 9],
  ['rollback-proof', 10],
  ['retirement-proof', 11]
]);

type InputKind =
  | 'hash-diff'
  | 'execution-evidence'
  | 'non-regression'
  | 'quality-comparison'
  | 'registry-candidate'
  | 'map-equivalence'
  | 'polymorph-impact'
  | 'propagation-report'
  | 'review-advisory'
  | 'human-review'
  | 'rollback-proof'
  | 'retirement-proof';

interface InputDocument {
  schemaId?: string;
  expectedReport?: Record<string, unknown>;
  evidence?: {
    propagationReport?: Record<string, unknown>;
    report?: Record<string, unknown>;
    decisionLog?: Record<string, unknown>;
  };
  reportId?: string;
  proofId?: string;
  evidenceId?: string;
  [key: string]: unknown;
}

interface RawInput {
  kind?: string;
  document?: Record<string, unknown>;
  report?: Record<string, unknown>;
  value?: Record<string, unknown>;
  path?: string;
  reportPath?: string;
  evidencePath?: string;
}

interface NormalizedInput {
  kind: InputKind;
  path: string;
  document: InputDocument;
}

interface InputRef {
  kind: InputKind;
  path: string;
  schemaId: string;
  summary: string;
  reportId?: string;
}

export function inferInputKind(kindOrSchemaId: string): InputKind {
  switch (kindOrSchemaId) {
    case 'hash-diff':
    case 'atm.hashDiffReport':
      return 'hash-diff';
    case 'execution-evidence':
    case 'atm.executionEvidence':
      return 'execution-evidence';
    case 'non-regression':
    case 'atm.police.nonRegressionReport':
      return 'non-regression';
    case 'quality-comparison':
    case 'atm.police.qualityComparisonReport':
      return 'quality-comparison';
    case 'registry-candidate':
    case 'atm.police.registryCandidateReport':
      return 'registry-candidate';
    case 'map-equivalence':
    case 'atm.mapEquivalenceReport':
      return 'map-equivalence';
    case 'polymorph-impact':
    case 'atm.polymorphImpactReport':
      return 'polymorph-impact';
    case 'propagation-report':
    case 'atm.propagationReport':
      return 'propagation-report';
    case 'review-advisory':
    case 'atm.reviewAdvisoryReport':
      return 'review-advisory';
    case 'human-review':
    case 'atm.humanReviewDecision':
      return 'human-review';
    case 'rollback-proof':
    case 'atm.rollbackProof':
    case 'atm.evidence.rollbackProof':
      return 'rollback-proof';
    case 'retirement-proof':
    case 'atm.retirementProof':
      return 'retirement-proof';
    default:
      throw new Error(`Unsupported upgrade proposal input kind: ${kindOrSchemaId}`);
  }
}

export function unwrapKnownInputDocument(document: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return document;
  }
  if (document.expectedReport && !document.schemaId) {
    return document.expectedReport;
  }
  if (document.evidence?.propagationReport && !document.schemaId) {
    return document.evidence.propagationReport;
  }
  if (document.evidence?.report && !document.schemaId) {
    return document.evidence.report;
  }
  if (document.evidence?.decisionLog && !document.schemaId) {
    return document.evidence.decisionLog;
  }
  return document;
}

export function resolveInputSchemaId(kind: InputKind, document: InputDocument): string {
  if (typeof document?.schemaId === 'string' && document.schemaId.length > 0) {
    return document.schemaId;
  }
  if (kind === 'review-advisory') {
    return 'atm.reviewAdvisoryReport';
  }
  return String(kind);
}

export function createInputSummary(kind: InputKind): string {
  switch (kind) {
    case 'hash-diff':
      return 'hash-diff input';
    case 'execution-evidence':
      return 'execution-evidence input';
    case 'non-regression':
      return 'non-regression input';
    case 'quality-comparison':
      return 'quality-comparison input';
    case 'registry-candidate':
      return 'registry-candidate input';
    case 'map-equivalence':
      return 'map-equivalence input';
    case 'polymorph-impact':
      return 'polymorph-impact input';
    case 'propagation-report':
      return 'propagation-report input';
    case 'review-advisory':
      return 'review-advisory input';
    case 'human-review':
      return 'human-review input';
    case 'rollback-proof':
      return 'rollback-proof input';
    case 'retirement-proof':
      return 'retirement-proof input';
    default:
      return 'upgrade-input';
  }
}

export function normalizeInputDocument(input: RawInput): NormalizedInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Upgrade proposal inputs must be objects.');
  }

  const document = unwrapKnownInputDocument(input.document ?? input.report ?? input.value ?? null);
  if (!document || typeof document !== 'object') {
    throw new Error('Upgrade proposal inputs require a document payload.');
  }

  const inferredKind = inferInputKind((input.kind ?? (document as InputDocument).schemaId) as string);
  const path = input.path ?? input.reportPath ?? input.evidencePath ?? null;
  if (!path) {
    throw new Error(`Upgrade proposal input ${inferredKind} requires a path.`);
  }

  return {
    kind: inferredKind,
    path,
    document: document as InputDocument
  };
}

export function findInput(inputs: NormalizedInput[], expectedKind: InputKind): NormalizedInput | null {
  return inputs.find((entry) => entry.kind === expectedKind) ?? null;
}

export function requireInput(inputs: NormalizedInput[], expectedKind: InputKind): NormalizedInput {
  const input = findInput(inputs, expectedKind);
  if (!input) {
    throw new Error(`Upgrade proposal requires a ${expectedKind} input document.`);
  }
  return input;
}

export function buildInputRefs(inputs: NormalizedInput[]): InputRef[] {
  return [...inputs]
    .sort((left, right) => {
      const leftPriority = INPUT_KIND_PRIORITY.get(left.kind) ?? 99;
      const rightPriority = INPUT_KIND_PRIORITY.get(right.kind) ?? 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.path.localeCompare(right.path);
    })
    .map((input) => {
      const ref: InputRef = {
        kind: input.kind,
        path: input.path,
        schemaId: resolveInputSchemaId(input.kind, input.document),
        summary: createInputSummary(input.kind)
      };
      if (typeof input.document.reportId === 'string' && input.document.reportId.length > 0) {
        ref.reportId = input.document.reportId;
      } else if (typeof input.document.proofId === 'string' && input.document.proofId.length > 0) {
        ref.reportId = input.document.proofId;
      } else if (typeof input.document.evidenceId === 'string' && input.document.evidenceId.length > 0) {
        ref.reportId = input.document.evidenceId;
      }
      return ref;
    });
}
