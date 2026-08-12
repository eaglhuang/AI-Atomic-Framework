// atm.causal-validator-selector — Selection Policy (the pure evaluator).
//
// evaluateValidationContract() is the single evaluator that decides the smallest
// sound task-required case set from explicit references and causal impact edges,
// plus the advisory and phase-suite sets, exact executable manifests,
// deterministic causal reasons for every selection and omission, phase owners,
// freshness inputs and unknown-boundary diagnostics. Runner and batch adapters
// delegate required-set computation here instead of each recomputing their own;
// a missing evaluator makes required validation fail closed rather than
// defaulting to a full run. It never executes commands and never mutates
// evidence. The decentralized shard machinery it can consume lives in
// packages/core/src/evidence/test-case-catalog.ts.

import {
  OBSERVATION_SNAPSHOT_SCHEMA_ID,
  type ObservedEvidenceSnapshot
} from './observed-source.ts';

export const VALIDATION_CONTRACT_EVALUATION_SCHEMA_ID = 'atm.validationContractEvaluation.v1' as const;

export type ValidationRiskTier = 'low' | 'medium' | 'high';

export interface ValidationContractContribution {
  readonly caseId: string;
  readonly coversAcceptance?: readonly string[];
  readonly coversImpactEdges?: readonly string[];
  readonly responsibility?: string | null;
  readonly command?: string | null;
  readonly contractEdge?: string | null;
  readonly dependencyEdge?: string | null;
  readonly phase?: string | null;
}

export interface ValidationContractTask {
  readonly workItemId?: string | null;
  readonly requiredTestCaseIds?: readonly string[];
  readonly phaseTestCaseIds?: readonly string[];
  readonly advisoryTestCaseIds?: readonly string[];
  readonly testContributions?: readonly ValidationContractContribution[];
  readonly causalGraph?: { readonly causalImpactEdges?: readonly string[] } | null;
  readonly acceptance?: readonly string[];
}

export interface ValidationContractChangeSet {
  readonly changedFiles?: readonly string[];
  readonly declaredImpactEdges?: readonly string[];
  readonly riskTier?: ValidationRiskTier;
}

export interface ValidationContractCatalogCase {
  readonly caseId: string;
  readonly command?: string | null;
  readonly responsibility?: string | null;
  readonly coversAcceptance?: readonly string[];
  readonly coversImpactEdges?: readonly string[];
  readonly pathTriggers?: readonly string[];
  readonly phase?: string | null;
  readonly groupId?: string | null;
  readonly broadSuite?: boolean;
}

export interface ValidationContractCatalog {
  readonly cases: readonly ValidationContractCatalogCase[];
}

export interface ValidationContractEvidenceReceipt {
  readonly caseId: string;
  /**
   * Legacy, caller-declared outcome.  New producers must instead provide an
   * observedOutcome.  When observedOutcome exists this field is deliberately
   * ignored by the freshness evaluator.
   */
  readonly status?: string | null;
  readonly gitHead?: string | null;
  readonly observedAt?: string | null;
  readonly freshUntil?: string | null;
  /**
   * Process fact collected through the observed-evidence port.  This is a
   * deep boundary: the evaluator derives pass/fail from its exitCode and
   * refuses malformed, unavailable, or conflicting observations.
   */
  readonly observedOutcome?: ObservedEvidenceSnapshot | null;
}

export interface ValidationContractEvidence {
  readonly receipts?: readonly ValidationContractEvidenceReceipt[];
  readonly gitHead?: string | null;
  readonly now?: string | null;
  readonly freshnessWindowMs?: number | null;
}

export type ValidationSelectionResponsibility = 'task-required' | 'phase-suite' | 'advisory';

export interface ValidationContractSelection {
  readonly caseId: string;
  readonly responsibility: ValidationSelectionResponsibility;
  readonly command: string | null;
  readonly causalReason: string;
  readonly coversAcceptance: readonly string[];
  readonly coversImpactEdges: readonly string[];
  readonly phase: string | null;
  readonly withinImpactCone: boolean;
  readonly executable: boolean;
}

export interface ValidationContractOmission {
  readonly ref: string;
  readonly kind: 'case' | 'impact-edge' | 'acceptance' | 'changed-path';
  readonly reason: string;
}

export type ValidationFreshnessStatus = 'fresh' | 'missing' | 'stale' | 'failed';

export interface ValidationContractFreshnessInput {
  readonly caseId: string;
  readonly status: ValidationFreshnessStatus;
  readonly reason: string;
  readonly receiptGitHead: string | null;
}

export interface ValidationContractDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly needsClarification: boolean;
  readonly ref: string | null;
}

export interface ValidationContractMetrics {
  readonly catalogCaseCount: number;
  readonly requiredCount: number;
  readonly advisoryCount: number;
  readonly phaseCount: number;
  readonly selectionRatio: number;
  readonly impactConeEdgeCount: number;
  readonly riskTier: ValidationRiskTier;
  readonly unknownBoundaryCount: number;
  readonly omittedCount: number;
}

export interface ValidationContractEvaluation {
  readonly schemaId: typeof VALIDATION_CONTRACT_EVALUATION_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly evaluatorId: 'atm.causal-validator-selector';
  readonly failClosed: boolean;
  readonly required: readonly ValidationContractSelection[];
  readonly advisory: readonly ValidationContractSelection[];
  readonly phaseSuite: readonly ValidationContractSelection[];
  readonly requiredCaseIds: readonly string[];
  readonly advisoryCaseIds: readonly string[];
  readonly phaseCaseIds: readonly string[];
  readonly executableManifests: readonly {
    readonly caseId: string;
    readonly command: string;
    readonly responsibility: ValidationSelectionResponsibility;
  }[];
  readonly causalReasons: readonly { readonly caseId: string; readonly reason: string }[];
  readonly omissions: readonly ValidationContractOmission[];
  readonly phaseOwners: readonly { readonly phase: string; readonly caseIds: readonly string[] }[];
  readonly freshnessInputs: readonly ValidationContractFreshnessInput[];
  readonly unknownBoundaryDiagnostics: readonly ValidationContractDiagnostic[];
  readonly metrics: ValidationContractMetrics;
}

const BROAD_SUITE_PATTERN = /^(npm run )?(typecheck|lint|validate:cli|validate:schemas|test|validate:all)\b|\.static\.all\b|\btier[:=]full\b|^(language|integration)\.[a-z0-9_.-]+\.(all|full)$/;

function isBroadSuiteRef(value: string, broadSuite?: boolean): boolean {
  if (broadSuite === true) return true;
  const normalized = String(value || '').trim().toLowerCase().replace(/\\/g, '/');
  return normalized ? BROAD_SUITE_PATTERN.test(normalized) : false;
}

export function evaluateValidationContract(
  task: ValidationContractTask,
  changeSet: ValidationContractChangeSet,
  catalog: ValidationContractCatalog,
  evidence: ValidationContractEvidence = {}
): ValidationContractEvaluation {
  const caseIndex = new Map<string, ValidationContractCatalogCase>();
  for (const entry of catalog.cases ?? []) {
    if (entry?.caseId) caseIndex.set(entry.caseId, entry);
  }
  const contributionIndex = new Map<string, ValidationContractContribution>();
  for (const entry of task.testContributions ?? []) {
    if (entry?.caseId) contributionIndex.set(entry.caseId, entry);
  }

  const impactCone = new Set(normalizeStringList(task.causalGraph?.causalImpactEdges));
  const riskTier: ValidationRiskTier = changeSet.riskTier ?? 'low';
  const requiredIds = normalizeStringList(task.requiredTestCaseIds);
  const phaseIds = normalizeStringList(task.phaseTestCaseIds);
  const advisoryIds = normalizeStringList(task.advisoryTestCaseIds);

  const omissions: ValidationContractOmission[] = [];
  const diagnostics: ValidationContractDiagnostic[] = [];

  const resolveSelection = (
    caseId: string,
    responsibility: ValidationSelectionResponsibility,
    deepenedFromCone = false
  ): ValidationContractSelection => {
    const catalogCase = caseIndex.get(caseId);
    const contribution = contributionIndex.get(caseId);
    const coversAcceptance = uniqueSorted([
      ...normalizeStringList(catalogCase?.coversAcceptance),
      ...normalizeStringList(contribution?.coversAcceptance)
    ]);
    const coversImpactEdges = uniqueSorted([
      ...normalizeStringList(catalogCase?.coversImpactEdges),
      ...normalizeStringList(contribution?.coversImpactEdges)
    ]);
    const command = firstNonEmpty([catalogCase?.command, contribution?.command]);
    const broad = isBroadSuiteRef(caseId, catalogCase?.broadSuite);
    const dependencyDeclared = Boolean(contribution?.dependencyEdge || contribution?.contractEdge);
    const withinImpactCone = coversImpactEdges.length === 0
      ? impactCone.size === 0
      : coversImpactEdges.some((edge) => impactCone.has(edge));
    const executable = Boolean(command) && (!broad || dependencyDeclared || responsibility !== 'task-required');

    if (responsibility === 'task-required' && broad && !dependencyDeclared) {
      diagnostics.push({
        code: 'ATM_VALIDATION_CONTRACT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE',
        severity: 'error',
        message: `Task-required case ${caseId} maps to a broad suite without a declared dependency/contract edge; required validation fails closed instead of running the full repository.`,
        needsClarification: true,
        ref: caseId
      });
    }
    if (!command) {
      diagnostics.push({
        code: 'ATM_VALIDATION_CONTRACT_CASE_MANIFEST_UNRESOLVED',
        severity: responsibility === 'task-required' ? 'error' : 'warning',
        message: `Case ${caseId} has no executable manifest in the resolved catalog or task contributions.`,
        needsClarification: responsibility === 'task-required',
        ref: caseId
      });
    }

    const reasonParts: string[] = [];
    reasonParts.push(`selected as ${responsibility}`);
    if (deepenedFromCone) reasonParts.push('deepened by high risk inside the proven impact cone');
    if (coversAcceptance.length > 0) reasonParts.push(`covers acceptance ${coversAcceptance.join(', ')}`);
    if (coversImpactEdges.length > 0) reasonParts.push(`covers impact edges ${coversImpactEdges.join(', ')}`);
    if (coversAcceptance.length === 0 && coversImpactEdges.length === 0) {
      reasonParts.push('explicitly referenced by the task contract');
    }

    return {
      caseId,
      responsibility,
      command: command ?? null,
      causalReason: reasonParts.join('; '),
      coversAcceptance,
      coversImpactEdges,
      phase: firstNonEmpty([contribution?.phase, catalogCase?.phase]) ?? null,
      withinImpactCone,
      executable
    };
  };

  const required = requiredIds.map((caseId) => resolveSelection(caseId, 'task-required'));
  const phaseSuite = phaseIds.map((caseId) => resolveSelection(caseId, 'phase-suite'));
  const advisory = advisoryIds.map((caseId) => resolveSelection(caseId, 'advisory'));

  // High risk deepens testing only inside the proven impact cone: promote
  // advisory cases whose impact edges fall within the cone to required, never
  // pulling in cases outside the cone.
  const requiredIdSet = new Set(requiredIds);
  if (riskTier === 'high' && impactCone.size > 0) {
    for (const candidate of advisory) {
      if (requiredIdSet.has(candidate.caseId)) continue;
      if (candidate.withinImpactCone && candidate.coversImpactEdges.length > 0) {
        required.push(resolveSelection(candidate.caseId, 'task-required', true));
        requiredIdSet.add(candidate.caseId);
      } else {
        omissions.push({
          ref: candidate.caseId,
          kind: 'case',
          reason: 'high-risk deepening skipped: case lies outside the proven impact cone'
        });
      }
    }
  }

  // Fail closed: a task with a change set but no resolvable required contract
  // must not default to a full-repository run.
  const hasChange = normalizeStringList(changeSet.changedFiles).length > 0;
  const executableRequired = required.filter((entry) => entry.executable);
  let failClosed = false;
  if (required.length === 0 && hasChange) {
    failClosed = true;
    diagnostics.push({
      code: 'ATM_VALIDATION_CONTRACT_MISSING_REQUIRED_SET',
      severity: 'error',
      message: 'Change set present but the task declares no resolvable required test cases; required validation fails closed rather than running the full repository.',
      needsClarification: true,
      ref: null
    });
  }
  if (required.length > 0 && executableRequired.length === 0) {
    failClosed = true;
  }

  // Unknown boundaries: changed files not mapped to any impact edge or case
  // path trigger request clarification instead of silently widening the run.
  const knownTriggers: { pattern: string; caseId: string }[] = [];
  for (const entry of catalog.cases ?? []) {
    for (const pattern of normalizeStringList(entry.pathTriggers)) {
      knownTriggers.push({ pattern, caseId: entry.caseId });
    }
  }
  const declaredEdges = new Set([...impactCone, ...normalizeStringList(changeSet.declaredImpactEdges)]);
  for (const changedFile of normalizeStringList(changeSet.changedFiles)) {
    const matched = knownTriggers.some((trigger) => matchesPattern(trigger.pattern, changedFile));
    if (!matched && declaredEdges.size === 0) {
      diagnostics.push({
        code: 'ATM_VALIDATION_CONTRACT_UNKNOWN_BOUNDARY',
        severity: 'warning',
        message: `Changed file ${changedFile} maps to no known impact edge or case path trigger; requesting scope/impact clarification instead of running the full repository.`,
        needsClarification: true,
        ref: changedFile
      });
      omissions.push({
        ref: changedFile,
        kind: 'changed-path',
        reason: 'no impact edge or case path trigger matched; clarification requested'
      });
    }
  }

  // Omissions with deterministic causal reasons for every catalog case that was
  // not selected as task-required.
  const selectedIds = new Set<string>([
    ...required.map((entry) => entry.caseId),
    ...phaseSuite.map((entry) => entry.caseId),
    ...advisory.map((entry) => entry.caseId)
  ]);
  for (const entry of catalog.cases ?? []) {
    if (selectedIds.has(entry.caseId)) continue;
    const edges = normalizeStringList(entry.coversImpactEdges);
    const inCone = edges.some((edge) => impactCone.has(edge));
    omissions.push({
      ref: entry.caseId,
      kind: 'case',
      reason: inCone
        ? 'within the impact cone but not referenced by the task-required contract'
        : 'no causal relationship to the declared impact edges or required contract'
    });
  }

  // Acceptance criteria not covered by any selected case are omissions too.
  const coveredAcceptance = new Set<string>();
  for (const entry of [...required, ...phaseSuite]) {
    for (const acc of entry.coversAcceptance) coveredAcceptance.add(acc);
  }
  for (const acc of normalizeStringList(task.acceptance)) {
    const accId = acc.split(/\s+/)[0];
    if (accId && !coveredAcceptance.has(accId)) {
      omissions.push({
        ref: accId,
        kind: 'acceptance',
        reason: 'acceptance criterion not covered by any selected required or phase-suite case'
      });
    }
  }

  const freshnessInputs = computeFreshnessInputs([...required, ...phaseSuite], evidence);
  const phaseOwners = groupPhaseOwners(phaseSuite);

  const catalogCaseCount = (catalog.cases ?? []).length;
  const requiredCaseIds = uniqueSorted(required.map((entry) => entry.caseId));
  const advisoryCaseIds = uniqueSorted(advisory.map((entry) => entry.caseId));
  const phaseCaseIds = uniqueSorted(phaseSuite.map((entry) => entry.caseId));
  const executableManifests = [...required, ...phaseSuite, ...advisory]
    .filter((entry) => entry.command)
    .map((entry) => ({ caseId: entry.caseId, command: entry.command as string, responsibility: entry.responsibility }));

  return {
    schemaId: VALIDATION_CONTRACT_EVALUATION_SCHEMA_ID,
    specVersion: '0.1.0',
    evaluatorId: 'atm.causal-validator-selector',
    failClosed,
    required,
    advisory,
    phaseSuite,
    requiredCaseIds,
    advisoryCaseIds,
    phaseCaseIds,
    executableManifests,
    causalReasons: [...required, ...phaseSuite, ...advisory].map((entry) => ({ caseId: entry.caseId, reason: entry.causalReason })),
    omissions,
    phaseOwners,
    freshnessInputs,
    unknownBoundaryDiagnostics: diagnostics,
    metrics: {
      catalogCaseCount,
      requiredCount: required.length,
      advisoryCount: advisory.length,
      phaseCount: phaseSuite.length,
      selectionRatio: catalogCaseCount > 0 ? Number((required.length / catalogCaseCount).toFixed(4)) : 0,
      impactConeEdgeCount: impactCone.size,
      riskTier,
      unknownBoundaryCount: diagnostics.filter((entry) => entry.code === 'ATM_VALIDATION_CONTRACT_UNKNOWN_BOUNDARY').length,
      omittedCount: omissions.length
    }
  };
}

function computeFreshnessInputs(
  selections: readonly ValidationContractSelection[],
  evidence: ValidationContractEvidence
): ValidationContractFreshnessInput[] {
  const receipts = new Map<string, ValidationContractEvidenceReceipt>();
  for (const receipt of evidence.receipts ?? []) {
    if (receipt?.caseId) receipts.set(receipt.caseId, receipt);
  }
  const nowMs = evidence.now ? Date.parse(evidence.now) : Date.now();
  const expectedHead = evidence.gitHead ?? null;
  const seen = new Set<string>();
  const inputs: ValidationContractFreshnessInput[] = [];
  for (const selection of selections) {
    if (seen.has(selection.caseId)) continue;
    seen.add(selection.caseId);
    const receipt = receipts.get(selection.caseId);
    if (!receipt) {
      inputs.push({ caseId: selection.caseId, status: 'missing', reason: 'no validation receipt for this case', receiptGitHead: null });
      continue;
    }
    const receiptHead = receipt.gitHead ?? null;
    const observedOutcome = evaluateObservedOutcome(receipt.observedOutcome);
    if (observedOutcome.kind === 'missing') {
      inputs.push({ caseId: selection.caseId, status: 'missing', reason: observedOutcome.reason, receiptGitHead: receiptHead });
      continue;
    }
    if (observedOutcome.kind === 'failed') {
      inputs.push({ caseId: selection.caseId, status: 'failed', reason: observedOutcome.reason, receiptGitHead: receiptHead });
      continue;
    }
    // A legacy receipt has no observedOutcome and remains readable during the
    // migration.  An adopted observedOutcome never trusts this caller claim.
    if (observedOutcome.kind === 'legacy' && String(receipt.status ?? '').toLowerCase() === 'failed') {
      inputs.push({ caseId: selection.caseId, status: 'failed', reason: 'receipt records a failed result', receiptGitHead: receiptHead });
      continue;
    }
    if (expectedHead && receiptHead && expectedHead !== receiptHead) {
      inputs.push({ caseId: selection.caseId, status: 'stale', reason: `receipt git head ${receiptHead} differs from expected ${expectedHead}`, receiptGitHead: receiptHead });
      continue;
    }
    if (receipt.freshUntil && Number.isFinite(Date.parse(receipt.freshUntil)) && Date.parse(receipt.freshUntil) < nowMs) {
      inputs.push({ caseId: selection.caseId, status: 'stale', reason: `receipt freshness expired at ${receipt.freshUntil}`, receiptGitHead: receiptHead });
      continue;
    }
    inputs.push({
      caseId: selection.caseId,
      status: 'fresh',
      reason: observedOutcome.kind === 'observed'
        ? 'observed process exited successfully and receipt is within freshness bounds'
        : 'legacy receipt passed and is within freshness bounds',
      receiptGitHead: receiptHead
    });
  }
  return inputs;
}

type ObservedOutcomeDecision =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'observed' }
  | { readonly kind: 'missing'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

function evaluateObservedOutcome(value: ObservedEvidenceSnapshot | null | undefined): ObservedOutcomeDecision {
  if (value === undefined || value === null) return { kind: 'legacy' };
  if (value.schemaId !== OBSERVATION_SNAPSHOT_SCHEMA_ID || value.status !== 'observed') {
    return { kind: 'missing', reason: 'observed validation outcome is unavailable or conflicting' };
  }
  if (value.sourceIds.length === 0 || !/^sha256:[a-f0-9]{64}$/i.test(value.valueDigest ?? '')) {
    return { kind: 'missing', reason: 'observed validation outcome lacks a source or digest' };
  }
  const execution = value.value;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution) || typeof (execution as { exitCode?: unknown }).exitCode !== 'number') {
    return { kind: 'missing', reason: 'observed validation outcome lacks a process exit code' };
  }
  return (execution as { exitCode: number }).exitCode === 0
    ? { kind: 'observed' }
    : { kind: 'failed', reason: `observed process exited with code ${(execution as { exitCode: number }).exitCode}` };
}

function groupPhaseOwners(
  phaseSuite: readonly ValidationContractSelection[]
): { phase: string; caseIds: readonly string[] }[] {
  const byPhase = new Map<string, string[]>();
  for (const selection of phaseSuite) {
    const phase = selection.phase ?? 'unassigned';
    byPhase.set(phase, [...(byPhase.get(phase) ?? []), selection.caseId]);
  }
  return [...byPhase.entries()]
    .map(([phase, caseIds]) => ({ phase, caseIds: uniqueSorted(caseIds) }))
    .sort((left, right) => left.phase.localeCompare(right.phase));
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function matchesPattern(pattern: string, candidatePath: string): boolean {
  const escaped = String(pattern || '')
    .replace(/\\/g, '/')
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(normalizePath(candidatePath));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function firstNonEmpty(values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) return text;
  }
  return null;
}
