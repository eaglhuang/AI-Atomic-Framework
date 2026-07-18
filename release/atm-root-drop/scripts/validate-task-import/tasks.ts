import { runEmergency } from '../../packages/cli/src/commands/emergency.ts';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import { fail } from './context.ts';

export async function expectOk(action: string, argv: string[]) {
  const result = await runTasks([action, ...argv]);
  if (!result.ok) {
    fail(`tasks ${action} ${argv.join(' ')} failed: ${result.messages.map((m) => `${m.code} ${m.text}`).join(' | ')}`);
  }
  return result;
}

export async function expectThrow(action: string, argv: string[], expectedCode: string) {
  try {
    await runTasks([action, ...argv]);
    fail(`tasks ${action} ${argv.join(' ')} expected to throw ${expectedCode} but succeeded.`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== expectedCode) {
      fail(`tasks ${action} ${argv.join(' ')} expected ${expectedCode} but threw ${code ?? 'unknown'}: ${(error as Error).message}`);
    }
  }
}

export async function createImportWriteLease(cwd: string, allowedFlags: readonly string[], reason: string): Promise<string> {
  const approval = await runEmergency([
    'approve',
    '--cwd', cwd,
    '--actor', 'validator',
    '--permission', 'backend.tasks.import.write',
    ...allowedFlags.flatMap((flag) => ['--allowed-flag', flag]),
    '--approval-text', 'Human approved validator import write test',
    '--reason', reason
  ]);
  const leaseId = (approval.evidence as { lease?: { leaseId?: string } })?.lease?.leaseId;
  if (!approval.ok || !leaseId) {
    fail(`emergency approve for import write failed: ${JSON.stringify(approval)}`);
    throw new Error('unreachable');
  }
  return leaseId;
}
