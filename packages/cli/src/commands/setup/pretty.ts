import type { CommandResult } from '../shared/result-core.ts';

interface SetupStepEvidence {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Human-readable setup summary for `--pretty` (the default on a terminal).
 * Keeps the step list, messages and the next or recovery command; the full
 * evidence (detection paths, dry-run plan) stays in `--json`.
 */
export function formatSetupPretty(result: CommandResult): string {
  const steps = (result.evidence.steps ?? []) as SetupStepEvidence[];
  const lines = [`[${result.ok ? 'OK' : 'FAIL'}] setup (${result.cwd})`];
  if (steps.length) {
    lines.push('steps:');
    for (const step of steps) {
      lines.push(`  ${step.ok ? 'ok    ' : 'failed'} ${step.name}`);
    }
  }
  for (const entry of result.messages ?? []) {
    lines.push(entry.level === 'error' ? `${entry.code}: ${entry.text}` : entry.text);
  }
  const recoveryCommand = result.evidence.recoveryCommand as string | null | undefined;
  if (recoveryCommand) lines.push(`Retry: ${recoveryCommand}`);
  lines.push('Run with --json for the full evidence.');
  return `${lines.join('\n')}\n`;
}
