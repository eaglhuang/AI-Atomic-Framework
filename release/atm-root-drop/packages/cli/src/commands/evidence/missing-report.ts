import path from 'node:path';
import { createFrameworkModeStatus, requiredValidationPassesForClosure } from '../framework-development.ts';
import { resolveTaskRunnerArbitration } from '../validate.ts';
import {
  canonicalizeValidatorIdentity,
  classifyValidatorTier,
  resolveValidatorExpectedCommand,
  type ValidatorEvidenceState,
  type ValidatorTier
} from './validator-classification.ts';
import {
  collectRecordCommandRuns,
  readRecordValidationPasses,
  readRecordFreshness,
  uniqueStrings
} from './command-runs.ts';
import { isRecord, isCommandRunProof } from './shared-utils.ts';
import {
  readEvidenceBundle,
  readTaskDocument,
  buildAutoEvidenceRequiredCommand
} from './evidence-store.ts';

export type { ValidatorEvidenceState };

export interface MissingValidatorFinding {
  readonly code: string;
  readonly validator: string;
  readonly category: 'absent' | 'failed-run' | 'stale' | 'diagnostic-only';
  readonly summary: string;
  readonly requiredCommand: string;
}

export interface ValidatorCatalogEntry {
  readonly name: string;
  readonly tier: ValidatorTier;
  /** TASK-AAO-0017 follow-up：標記此 validator 是否為 closure gate 必要條件 */
  readonly closureRequired: boolean;
  readonly expectedCommand: string;
  readonly evidenceState: ValidatorEvidenceState;
}

export interface MissingValidatorReport {
  readonly schemaId: 'atm.missingValidatorReport.v1';
  readonly taskId: string;
  readonly ok: boolean;
  readonly tldr: string;
  readonly totalRequired: number;
  readonly passedCount: number;
  readonly missingCount: number;
  readonly categories: {
    readonly absent: readonly string[];
    readonly failedRun: readonly string[];
    readonly stale: readonly string[];
    readonly diagnosticOnly: readonly string[];
  };
  /** Closure-required 缺失（advisory gates 不會進入此清單） */
  readonly missingValidationPasses: readonly MissingValidatorFinding[];
  /** Closure-required 中 absent + failed-run 的 hard blocker 子集 */
  readonly blockingFindings: readonly MissingValidatorFinding[];
  /** TASK-AAO-0017 follow-up：batch-tier advisory gate 缺失，不阻擋 close */
  readonly advisoryFindings: readonly MissingValidatorFinding[];
  readonly validators: readonly ValidatorCatalogEntry[];
}

export function classifyValidatorEvidenceState(bundle: readonly Record<string, unknown>[], gate: string): ValidatorEvidenceState {
  const rank: Record<string, number> = { pass: 3, stale: 2, 'diagnostic-only': 1 };
  let bestPositive: 'pass' | 'stale' | 'diagnostic-only' | null = null;
  let sawFailedRun = false;
  for (const record of bundle) {
    const passes = readRecordValidationPasses(record);
    const commandRuns = collectRecordCommandRuns(record);
    if (passes.includes(gate)) {
      const proof = commandRuns.some((run) => isCommandRunProof(run));
      const freshness = readRecordFreshness(record);
      const state: 'pass' | 'stale' | 'diagnostic-only' = (freshness === 'fresh' && proof)
        ? 'pass'
        : proof ? 'stale' : 'diagnostic-only';
      if (!bestPositive || rank[state] > rank[bestPositive]) bestPositive = state;
    }
    for (const run of commandRuns) {
      const runValidators = Array.isArray((run as { validators?: unknown }).validators)
        ? ((run as { validators: unknown[] }).validators)
            .filter((v): v is string => typeof v === 'string')
            .map((v) => canonicalizeValidatorIdentity(v))
        : [];
      const cmd = typeof (run as { command?: unknown }).command === 'string' ? (run as { command: string }).command : '';
      const matches = runValidators.includes(gate) || canonicalizeValidatorIdentity(cmd) === gate;
      const exitCode = (run as { exitCode?: unknown }).exitCode;
      if (matches && typeof exitCode === 'number' && exitCode !== 0) sawFailedRun = true;
    }
  }
  if (bestPositive === 'pass') return 'pass';
  if (sawFailedRun) return 'failed-run';
  return bestPositive ?? 'absent';
}

export function buildMissingValidatorFinding(
  gate: string,
  state: Exclude<ValidatorEvidenceState, 'pass'>,
  taskId: string,
  actor: string,
  runnerKind: 'dev-source' | 'frozen-runner'
): MissingValidatorFinding {
  const expectedCommand = resolveValidatorExpectedCommand(gate);
  const requiredCommand = buildAutoEvidenceRequiredCommand(taskId, actor, expectedCommand, gate, runnerKind);
  if (state === 'absent') {
    return {
      code: 'ATM_EVIDENCE_VALIDATOR_ABSENT',
      validator: gate, category: 'absent',
      summary: `No evidence record claims validator '${gate}' passed. Use evidence run so ATM executes the validator and captures command-backed evidence.`,
      requiredCommand
    };
  }
  if (state === 'failed-run') {
    return {
      code: 'ATM_EVIDENCE_VALIDATOR_FAILED_RUN',
      validator: gate, category: 'failed-run',
      summary: `Validator '${gate}' has at least one command run with non-zero exit code. Fix the failure and rerun it through evidence run to add fresh evidence.`,
      requiredCommand
    };
  }
  if (state === 'stale') {
    return {
      code: 'ATM_EVIDENCE_VALIDATOR_STALE',
      validator: gate, category: 'stale',
      summary: `Validator '${gate}' evidence is not fresh (historical-reference or draft). Rerun it through evidence run in this session to refresh.`,
      requiredCommand
    };
  }
  return {
    code: 'ATM_EVIDENCE_VALIDATOR_DIAGNOSTIC_ONLY',
    validator: gate, category: 'diagnostic-only',
    summary: `Validator '${gate}' evidence exists but lacks command-backed proof (stdout/stderr sha256 + exit code). Rerun via evidence run to attach a proof.`,
    requiredCommand
  };
}


export function computeMissingValidatorReport(
  cwd: string,
  taskId: string,
  actorId: string
): MissingValidatorReport {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTaskId = taskId.trim();
  const runnerArbitration = resolveTaskRunnerArbitration(resolvedCwd, resolvedTaskId);

  // 1. 取得 framework 必要 gates
  const frameworkStatus = createFrameworkModeStatus({ cwd: resolvedCwd });
  const frameworkGates = frameworkStatus.requiredGates;

  // 2. 取得 task card 宣告的 validators
  const taskDocument = readTaskDocument(resolvedCwd, resolvedTaskId);
  const taskDeclaredValidators: string[] = Array.isArray(taskDocument?.validators)
    ? (taskDocument.validators as unknown[])
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => canonicalizeValidatorIdentity(v.trim()))
        .filter(Boolean)
    : [];

  // 3. 合併並去重
  const allGates = uniqueStrings([...frameworkGates, ...taskDeclaredValidators]);

  // 4. 讀取 evidence bundle
  const bundle = readEvidenceBundle(resolvedCwd, resolvedTaskId);
  const bundleRecords = bundle.evidence.map((r) =>
    isRecord(r) ? r : {} as Record<string, unknown>
  );

  // 5. 分類每個 gate 的 evidence 狀態
  // TASK-AAO-0017 follow-up：closure-required 與 advisory 分開計算，
  // batch-tier framework 健康類 gate 為 advisory，缺失不應阻擋 close。
  const absent: string[] = [];
  const failedRun: string[] = [];
  const stale: string[] = [];
  const diagnosticOnly: string[] = [];

  const requiredFindings: MissingValidatorFinding[] = [];
  const advisoryFindings: MissingValidatorFinding[] = [];
  const catalogEntries: ValidatorCatalogEntry[] = [];

  const scopePaths: string[] = Array.isArray(taskDocument?.scopePaths)
    ? (taskDocument.scopePaths as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  // ATM-BUG-2026-07-12-155 (TASK-AAO-FABLE-003): the close --write closure
  // packet requires `requiredValidationPassesForClosure(frameworkGates,
  // changedFiles)` unconditionally, while this readiness report previously
  // applied scope-conditional exemptions (validate:cli / git-head-evidence)
  // via isClosureRequiredValidator. That drift let pre-close and close
  // dry-run report "ready" and then fail at write with
  // ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID. Readiness now consumes the exact
  // same write-side set so both surfaces expose one validator contract; the
  // write path stays authoritative and is not weakened.
  const declaredChangedFiles = uniqueStrings([
    ...scopePaths,
    ...(Array.isArray(taskDocument?.deliverables)
      ? (taskDocument.deliverables as unknown[]).filter((p): p is string => typeof p === 'string')
      : [])
  ]);
  const writeRequiredSet = new Set(requiredValidationPassesForClosure(frameworkGates, declaredChangedFiles));

  for (const gate of allGates) {
    const state = classifyValidatorEvidenceState(bundleRecords, gate);
    const tier = classifyValidatorTier(gate);
    const closureRequired = taskDeclaredValidators.includes(gate) || writeRequiredSet.has(gate);
    catalogEntries.push({
      name: gate,
      tier,
      closureRequired,
      expectedCommand: resolveValidatorExpectedCommand(gate),
      evidenceState: state
    });
    if (state !== 'pass') {
      const finding = buildMissingValidatorFinding(gate, state, resolvedTaskId, actorId, runnerArbitration.preferredRunnerKind);
      if (closureRequired) {
        requiredFindings.push(finding);
        if (state === 'absent') absent.push(gate);
        else if (state === 'failed-run') failedRun.push(gate);
        else if (state === 'stale') stale.push(gate);
        else diagnosticOnly.push(gate);
      } else {
        advisoryFindings.push(finding);
      }
    }
  }

  const closureRequiredTotal = catalogEntries.filter((entry) => entry.closureRequired).length;
  const passedCount = closureRequiredTotal - requiredFindings.length;
  const missingCount = requiredFindings.length;
  const ok = missingCount === 0;

  // 6. 人類層 TL;DR
  let tldr: string;
  if (ok) {
    const adv = advisoryFindings.length > 0
      ? ` (${advisoryFindings.length} advisory framework gate(s) not satisfied; not blocking)`
      : '';
    tldr = `All ${closureRequiredTotal} closure-required validator(s) passed for task ${resolvedTaskId}${adv}.`;
  } else {
    const parts: string[] = [];
    if (absent.length) parts.push(`${absent.length} absent (no evidence): ${absent.join(', ')}`);
    if (failedRun.length) parts.push(`${failedRun.length} failed-run: ${failedRun.join(', ')}`);
    if (stale.length) parts.push(`${stale.length} stale (historical-reference/draft): ${stale.join(', ')}`);
    if (diagnosticOnly.length) parts.push(`${diagnosticOnly.length} diagnostic-only (no command proof): ${diagnosticOnly.join(', ')}`);
    tldr = `Task ${resolvedTaskId} close blocked — ${missingCount}/${closureRequiredTotal} closure-required validator(s) not satisfied. ${parts.join('; ')}.`;
  }

  // 7. blockingFindings = closure-required 中的 absent + failed-run
  //    （stale 和 diagnostic-only 是 closure-required 中的警告，非硬封鎖；advisory 全部排除）
  const blockingFindings = requiredFindings.filter((f) => f.category === 'absent' || f.category === 'failed-run');

  return {
    schemaId: 'atm.missingValidatorReport.v1',
    taskId: resolvedTaskId,
    ok,
    tldr,
    totalRequired: closureRequiredTotal,
    passedCount,
    missingCount,
    categories: { absent, failedRun, stale, diagnosticOnly },
    missingValidationPasses: requiredFindings,
    blockingFindings,
    advisoryFindings,
    validators: catalogEntries
  };
}

// ===== TASK-AAO-0142: Auto-run declared validators into evidence before close =====

export type AutoEvidenceDisposition =
  | 'to-run'
  | 'already-satisfied'
  | 'skipped-out-of-scope'
  | 'requires-approval';

export interface AutoEvidencePlanEntry {
  readonly validator: string;
  readonly capability: 'validator' | 'integration-test';
  readonly catalogKey: string | null;
  readonly disposition: AutoEvidenceDisposition;
  readonly command: string | null;
  readonly evidenceState: ValidatorEvidenceState;
  readonly reason: string;
  readonly requiredCommand: string | null;
  readonly linkedValidators: readonly string[];
}

export interface AutoEvidencePlan {
  readonly schemaId: 'atm.autoEvidencePlan.v1';
  readonly taskId: string;
  readonly mode: 'dry-run' | 'execute';
  readonly ok: boolean;
  readonly toRun: readonly AutoEvidencePlanEntry[];
  readonly alreadySatisfied: readonly AutoEvidencePlanEntry[];
  readonly skippedOutOfScope: readonly AutoEvidencePlanEntry[];
  readonly requiresApproval: readonly AutoEvidencePlanEntry[];
  readonly remediationCommand: string | null;
}

export interface AutoEvidenceExecutionResult {
  readonly schemaId: 'atm.autoEvidenceExecution.v1';
  readonly taskId: string;
  readonly ok: boolean;
  readonly plan: AutoEvidencePlan;
  readonly runs: ReadonlyArray<{
    readonly validator: string;
    readonly command: string;
    readonly ok: boolean;
    readonly errorCode?: string;
  }>;
  readonly failedValidator: string | null;
  readonly remediationCommand: string | null;
}
