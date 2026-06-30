import type { CommandResult } from './shared.ts';

export function resolveSummaryFields(): string[] {
  return ['taskId', 'status', 'claimedByActor', 'allowedFilesCount', 'nextAction'];
}

export function projectFields(result: CommandResult, fields: string[]): CommandResult {
  const projectedEvidence: Record<string, unknown> = {};
  if (result.evidence) {
    for (const field of fields) {
      const trimmed = field.trim();
      if (trimmed && trimmed in result.evidence) {
        projectedEvidence[trimmed] = result.evidence[trimmed];
      }
    }
  }
  const resultAny = result as unknown as Record<string, unknown>;
  return {
    ok: result.ok,
    command: result.command,
    mode: result.mode,
    cwd: result.cwd,
    messages: result.messages,
    ...(resultAny.warnings ? { warnings: resultAny.warnings } : {}),
    evidence: projectedEvidence
  } as CommandResult;
}

export function projectSummary(result: CommandResult): CommandResult {
  const summaryFields = resolveSummaryFields();
  const projected = projectFields(result, summaryFields);

  if (projected.evidence && projected.evidence.nextAction) {
    const nextAction = projected.evidence.nextAction;
    if (nextAction && typeof nextAction === 'object') {
      projected.evidence.nextAction = {
        code: (nextAction as Record<string, unknown>).code ?? null
      };
    }
  }
  return projected;
}
