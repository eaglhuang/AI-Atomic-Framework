import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { actorIdEnvVar, findActorByResolvedId, resolveActorId } from './actor-registry.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.ts';

type TaskClaimRecord = {
  actorId: string;
  leaseId: string;
  state: 'active' | 'released' | 'handoff' | 'taken_over';
};

export interface GitGovernanceViolation {
  readonly code: string;
  readonly detail: string;
}

export interface GitGovernanceCheckResult {
  readonly ok: boolean;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly claimLeaseId: string | null;
  readonly gitName: string | null;
  readonly gitEmail: string | null;
  readonly trailers: Readonly<Record<string, readonly string[]>>;
  readonly violations: readonly GitGovernanceViolation[];
}

export async function runAtmGit(argv: string[]) {
  const options = parseGitOptions(argv);
  if (options.action === 'prepare') {
    return runGitPrepare(options);
  }
  const check = evaluateGitGovernanceCheck({
    cwd: options.cwd,
    actorInput: options.actorId,
    taskId: options.taskId,
    requireTrailers: true
  });
  return makeResult({
    ok: check.ok,
    command: 'git',
    cwd: options.cwd,
    messages: [check.ok
      ? message('info', 'ATM_GIT_CHECK_OK', 'Git governance checks passed.')
      : message('error', 'ATM_GIT_CHECK_FAILED', 'Git governance checks failed.', {
        violations: check.violations
      })],
    evidence: {
      action: 'check',
      actorId: check.actorId,
      taskId: check.taskId,
      claimLeaseId: check.claimLeaseId,
      git: {
        name: check.gitName,
        email: check.gitEmail
      },
      trailers: check.trailers,
      violations: check.violations
    }
  });
}

export function evaluateGitGovernanceCheck(input: {
  cwd: string;
  actorInput: string | null;
  taskId: string | null;
  requireTrailers: boolean;
}): GitGovernanceCheckResult {
  const cwd = path.resolve(input.cwd);
  const resolvedActor = resolveActorId(input.actorInput ?? undefined);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', `git check requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const actorRecord = findActorByResolvedId(cwd, resolvedActor);
  const gitName = readGitConfig(cwd, 'user.name');
  const gitEmail = readGitConfig(cwd, 'user.email');
  const taskDocument = input.taskId ? readTaskDocument(cwd, input.taskId) : null;
  const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
  const trailers = parseTrailers(readHeadCommitMessage(cwd));

  const violations: GitGovernanceViolation[] = [];
  if (!actorRecord) {
    violations.push({
      code: 'actor-not-registered',
      detail: `Actor ${actorId} is not registered in .atm/catalog/registry/actors.json.`
    });
  }
  if (actorRecord?.gitName && gitName !== actorRecord.gitName) {
    violations.push({
      code: 'git-name-mismatch',
      detail: `git user.name is ${gitName ?? 'unset'}, expected ${actorRecord.gitName}.`
    });
  }
  if (actorRecord?.gitEmail && gitEmail !== actorRecord.gitEmail) {
    violations.push({
      code: 'git-email-mismatch',
      detail: `git user.email is ${gitEmail ?? 'unset'}, expected ${actorRecord.gitEmail}.`
    });
  }

  if (taskDocument && taskDocument.owner && String(taskDocument.owner) !== actorId) {
    violations.push({
      code: 'task-owner-mismatch',
      detail: `Task owner is ${String(taskDocument.owner)}, not ${actorId}.`
    });
  }
  if (claim && claim.state === 'active' && claim.actorId !== actorId) {
    violations.push({
      code: 'claim-owner-mismatch',
      detail: `Task claim owner is ${claim.actorId}, not ${actorId}.`
    });
  }

  if (input.requireTrailers) {
    const actorTrailers = trailers['ATM-Actor'] ?? [];
    if (!actorTrailers.includes(actorId)) {
      violations.push({
        code: 'trailer-actor-missing',
        detail: `Latest commit is missing trailer ATM-Actor: ${actorId}.`
      });
    }
    if (input.taskId) {
      const taskTrailers = trailers['ATM-Task'] ?? [];
      if (!taskTrailers.includes(input.taskId)) {
        violations.push({
          code: 'trailer-task-missing',
          detail: `Latest commit is missing trailer ATM-Task: ${input.taskId}.`
        });
      }
    }
    if (claim?.leaseId) {
      const claimTrailers = trailers['ATM-Claim'] ?? [];
      if (!claimTrailers.includes(claim.leaseId)) {
        violations.push({
          code: 'trailer-claim-missing',
          detail: `Latest commit is missing trailer ATM-Claim: ${claim.leaseId}.`
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    actorId,
    taskId: input.taskId,
    claimLeaseId: claim?.leaseId ?? null,
    gitName,
    gitEmail,
    trailers,
    violations
  };
}

function runGitPrepare(options: {
  cwd: string;
  action: 'prepare' | 'check';
  actorId: string | null;
  taskId: string | null;
  gitName: string | null;
  gitEmail: string | null;
}) {
  const resolvedActor = resolveActorId(options.actorId ?? undefined);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', `git prepare requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const actorRecord = findActorByResolvedId(options.cwd, resolvedActor);
  const nextName = options.gitName ?? actorRecord?.gitName ?? null;
  const nextEmail = options.gitEmail ?? actorRecord?.gitEmail ?? null;
  if (!nextName || !nextEmail) {
    throw new CliError('ATM_GIT_PREPARE_IDENTITY_MISSING', 'git prepare requires git name/email from actor registry or explicit --name/--email.', {
      exitCode: 2,
      details: { actorId }
    });
  }

  writeGitConfig(options.cwd, 'user.name', nextName);
  writeGitConfig(options.cwd, 'user.email', nextEmail);

  const claimLeaseId = options.taskId
    ? parseTaskClaim(readTaskDocument(options.cwd, options.taskId)?.claim)?.leaseId ?? null
    : null;
  const trailerHints = [
    `ATM-Actor: ${actorId}`,
    ...(options.taskId ? [`ATM-Task: ${options.taskId}`] : []),
    ...(claimLeaseId ? [`ATM-Claim: ${claimLeaseId}`] : []),
    ...(options.taskId ? [`ATM-Evidence: .atm/history/evidence/${options.taskId}.json`] : [])
  ];

  return makeResult({
    ok: true,
    command: 'git',
    cwd: options.cwd,
    messages: [message('info', 'ATM_GIT_PREPARED', 'Repo-local git identity has been prepared for the resolved actor.', {
      actorId,
      gitName: nextName,
      gitEmail: nextEmail
    })],
    evidence: {
      action: 'prepare',
      actorId,
      git: {
        name: nextName,
        email: nextEmail
      },
      trailerHints
    }
  });
}

function parseGitOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    action: null as 'prepare' | 'check' | null,
    actorId: null as string | null,
    taskId: null as string | null,
    gitName: null as string | null,
    gitEmail: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--name') {
      options.gitName = requireValue(argv, index, '--name');
      index += 1;
      continue;
    }
    if (arg === '--email') {
      options.gitEmail = requireValue(argv, index, '--email');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `git does not support option ${arg}`, { exitCode: 2 });
    }
    if (options.action) {
      throw new CliError('ATM_CLI_USAGE', 'git accepts only one action.', { exitCode: 2 });
    }
    if (arg !== 'prepare' && arg !== 'check') {
      throw new CliError('ATM_CLI_USAGE', 'git supports: prepare, check', { exitCode: 2 });
    }
    options.action = arg;
  }
  if (!options.action) {
    throw new CliError('ATM_CLI_USAGE', 'git requires an action (prepare | check).', { exitCode: 2 });
  }
  const action = options.action;
  return {
    ...options,
    action,
    cwd: path.resolve(options.cwd)
  };
}

function readTaskDocument(cwd: string, taskId: string): Record<string, unknown> | null {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, {
      exitCode: 2,
      details: {
        taskId,
        taskPath: relativePathFrom(cwd, taskPath)
      }
    });
  }
  return JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
}

function parseTaskClaim(value: unknown): TaskClaimRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const actorId = typeof candidate.actorId === 'string' ? candidate.actorId.trim() : '';
  const leaseId = typeof candidate.leaseId === 'string' ? candidate.leaseId.trim() : '';
  const stateRaw = typeof candidate.state === 'string' ? candidate.state.trim() : 'active';
  const state = stateRaw === 'released' || stateRaw === 'handoff' || stateRaw === 'taken_over' ? stateRaw : 'active';
  if (!actorId || !leaseId) {
    return null;
  }
  return { actorId, leaseId, state };
}

function readGitConfig(cwd: string, key: 'user.name' | 'user.email'): string | null {
  try {
    const value = execFileSync('git', ['config', '--local', '--get', key], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeGitConfig(cwd: string, key: 'user.name' | 'user.email', value: string) {
  execFileSync('git', ['config', '--local', key, value], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function readHeadCommitMessage(cwd: string): string | null {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}

function parseTrailers(commitMessage: string | null): Readonly<Record<string, readonly string[]>> {
  if (!commitMessage) {
    return {};
  }
  const trailers = new Map<string, string[]>();
  for (const line of commitMessage.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9-]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    if (!trailers.has(key)) {
      trailers.set(key, []);
    }
    trailers.get(key)?.push(value);
  }
  return Object.fromEntries(Array.from(trailers.entries()));
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `git requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}
