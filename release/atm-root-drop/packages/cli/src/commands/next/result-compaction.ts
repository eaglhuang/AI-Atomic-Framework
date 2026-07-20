import { buildFirstLayerCommandContract } from '../../../../core/src/guidance/index.ts';

const NEXT_LARGE_ARRAY_TRUNCATION_LIMIT = 20;
const NEXT_TRUNCATABLE_FRAMEWORK_STATUS_FIELDS = ['changedFiles', 'criticalChangedFiles', 'docsOnlyChangedFiles'] as const;
const NEXT_DUPLICATED_TOP_LEVEL_KEYS = [
  'nextAction',
  'taskIntent',
  'userNotice',
  'runnerMode',
  'frameworkReport',
  'frameworkClaim',
  'evidenceSummary',
  'guardReport',
  'taskflowReadiness',
  'commitBundle',
  'skillGrowth'
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactFrameworkStatusFileLists(frameworkStatus: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = { ...frameworkStatus };
  for (const field of NEXT_TRUNCATABLE_FRAMEWORK_STATUS_FIELDS) {
    const value = frameworkStatus[field];
    if (Array.isArray(value) && value.length > NEXT_LARGE_ARRAY_TRUNCATION_LIMIT) {
      compacted[field] = value.slice(0, NEXT_LARGE_ARRAY_TRUNCATION_LIMIT);
      compacted[`${field}Truncated`] = true;
      compacted[`${field}TotalCount`] = value.length;
    }
  }
  return compacted;
}

function compactPlaybookMessageData(data: Record<string, unknown>): Record<string, unknown> {
  // steps/doNot/commandSequence/governedGitEntrypoint are already the
  // authoritative content at evidence.nextAction.playbook; echoing them again
  // inside this message is what made ordinary routes balloon in size.
  const { steps: _steps, doNot: _doNot, commandSequence: _commandSequence, governedGitEntrypoint: _governedGitEntrypoint, ...rest } = data;
  return {
    ...rest,
    fullPlaybookPath: 'evidence.nextAction.playbook'
  };
}

/**
 * Trims the default `next` CLI envelope so ordinary prompt-scoped routes stay
 * readable in agent/tool transcripts. This only removes duplicated or
 * oversized diagnostic content that remains fully reachable elsewhere
 * (evidence.nextAction.playbook stays untouched; framework-mode status --json
 * keeps the full file lists). Pass --verbose to bypass this and get the
 * original untrimmed envelope. See ATM-BUG-2026-07-07-041.
 */
export function compactNextRouteResult<T extends { evidence?: Record<string, unknown>; messages?: unknown[] }>(result: T): T {
  const evidence = result.evidence;
  const firstLayerContract = buildFirstLayerCommandContract();
  const firstLayerCompactOrientation = {
    status: readNestedString(evidence, ['nextAction', 'status']) ?? readNestedString(result as Record<string, unknown>, ['nextAction', 'status']) ?? null,
    command: readNestedString(evidence, ['nextAction', 'command']) ?? readNestedString(result as Record<string, unknown>, ['nextAction', 'command']) ?? null,
    recommendedChannel: readNestedString(evidence, ['nextAction', 'recommendedChannel']) ?? null,
    ticketStates: firstLayerContract.ticketStates.map((entry) => ({
      state: entry.state,
      errorCode: entry.errorCode,
      statusCommand: entry.statusCommand,
      nextAction: entry.nextAction
    })),
    validatorSummary: buildValidatorSummary(evidence),
    fullOutput: 'rerun the same next command with --verbose --json'
  };
  const compactedEvidence = evidence && isPlainRecord(evidence.frameworkStatus)
    ? { ...evidence, frameworkStatus: compactFrameworkStatusFileLists(evidence.frameworkStatus), suppressToolBridgeProjection: true, firstLayerCompactOrientation }
    : evidence
      ? { ...evidence, suppressToolBridgeProjection: true, firstLayerCompactOrientation }
      : evidence;
  const messages = Array.isArray(result.messages)
    ? result.messages.map((entry) => {
      const record = isPlainRecord(entry) ? entry : null;
      if (record && record.code === 'ATM_CHANNEL_PLAYBOOK_REQUIRED' && isPlainRecord(record.data)) {
        return { ...record, data: compactPlaybookMessageData(record.data) };
      }
      return entry;
    })
    : result.messages;
  const compacted: Record<string, unknown> = {
    ...result,
    ...(compactedEvidence ? { evidence: compactedEvidence } : {}),
    ...(messages ? { messages } : {})
  };
  for (const key of NEXT_DUPLICATED_TOP_LEVEL_KEYS) {
    delete compacted[key];
  }
  return compacted as T;
}

function readNestedString(root: unknown, path: readonly string[]): string | null {
  let cursor = root;
  for (const key of path) {
    if (!isPlainRecord(cursor)) {
      return null;
    }
    cursor = cursor[key];
  }
  return typeof cursor === 'string' ? cursor : null;
}

function buildValidatorSummary(evidence: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!evidence) return null;
  const nextAction = evidence.nextAction;
  if (isPlainRecord(nextAction) && Array.isArray(nextAction.validators)) {
    return {
      count: nextAction.validators.length,
      validators: nextAction.validators.slice(0, 8),
      truncated: nextAction.validators.length > 8
    };
  }
  const doctorSummary = evidence.doctorSummary;
  if (Array.isArray(doctorSummary)) {
    return {
      count: doctorSummary.length,
      failed: doctorSummary.filter((entry) => isPlainRecord(entry) && entry.ok !== true).length,
      checks: doctorSummary.slice(0, 8)
    };
  }
  return null;
}
