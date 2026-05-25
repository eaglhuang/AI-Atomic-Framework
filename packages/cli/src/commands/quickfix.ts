import { CliError, makeResult, message, parseOptions } from './shared.ts';
import { resolveActorId } from './actor-registry.ts';
import {
  extractPathLikeStringsFromPrompt,
  readActiveQuickfixLock,
  releaseQuickfixLock,
  writeQuickfixLock
} from './work-channels.ts';

export async function runQuickfix(argv: string[]) {
  const { options } = parseOptions(argv, 'quickfix');
  const action = String(argv[0] ?? 'status').toLowerCase();
  if (action === 'status') {
    const lock = readActiveQuickfixLock(options.cwd);
    return makeResult({
      ok: true,
      command: 'quickfix',
      cwd: options.cwd,
      messages: [message('info', 'ATM_QUICKFIX_STATUS', lock ? 'Active quickfix lock found.' : 'No active quickfix lock found.', {
        active: Boolean(lock),
        actorId: lock?.actorId ?? null
      })],
      evidence: {
        action: 'status',
        lock
      }
    });
  }
  if (action === 'release') {
    const resolvedActor = resolveActorId(options.agent ?? undefined);
    if (!resolvedActor) {
      throw new CliError('ATM_ACTOR_ID_MISSING', 'quickfix release requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const released = releaseQuickfixLock(options.cwd, resolvedActor.actorId);
    return makeResult({
      ok: true,
      command: 'quickfix',
      cwd: options.cwd,
      messages: [message('info', 'ATM_QUICKFIX_RELEASED', released ? 'Quickfix lock released.' : 'No matching active quickfix lock to release.', {
        actorId: resolvedActor.actorId
      })],
      evidence: {
        action: 'release',
        actorId: resolvedActor.actorId,
        lock: released
      }
    });
  }
  if (action === 'claim') {
    const resolvedActor = resolveActorId(options.agent ?? undefined);
    if (!resolvedActor) {
      throw new CliError('ATM_ACTOR_ID_MISSING', 'quickfix claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const prompt = String(options.prompt ?? options.reason ?? '').trim();
    const allowedFiles = options.files.length > 0 ? options.files : extractPathLikeStringsFromPrompt(prompt);
    if (allowedFiles.length === 0) {
      throw new CliError('ATM_QUICKFIX_FILES_REQUIRED', 'quickfix claim needs path-like scope. Include a file path in the prompt or pass --files <csv>.', { exitCode: 2 });
    }
    const lock = writeQuickfixLock({
      cwd: options.cwd,
      actorId: resolvedActor.actorId,
      prompt: prompt || 'quickfix',
      reason: options.reason ?? null,
      allowedFiles
    });
    return makeResult({
      ok: true,
      command: 'quickfix',
      cwd: options.cwd,
      messages: [message('info', 'ATM_QUICKFIX_CLAIMED', 'Quickfix lock acquired.', {
        actorId: resolvedActor.actorId,
        allowedFiles: lock.allowedFiles
      })],
      evidence: {
        action: 'claim',
        actorId: resolvedActor.actorId,
        lock
      }
    });
  }
  throw new CliError('ATM_CLI_USAGE', 'quickfix supports: claim, status, release', { exitCode: 2 });
}
