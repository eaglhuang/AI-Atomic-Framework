import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { actorIdEnvVar, findActorByResolvedId, readRuntimeIdentityDefault, resolveActorId } from './actor-registry.ts';
import { resolveActorWorkSession } from './actor-session.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.ts';

type TaskClaimRecord = {
  actorId: string;
  leaseId: string;
  state: 'active' | 'released' | 'handoff' | 'taken_over';
};

interface GitIdentityProfile {
  readonly gitName: string | null;
  readonly gitEmail: string | null;
}

export interface GitGovernanceViolation {
  readonly code: string;
  readonly detail: string;
}

export interface GitGovernanceCheckResult {
  readonly ok: boolean;
  readonly actorId: string;
  readonly taskId: string | null;
  readonly claimLeaseId: string | null;
  readonly sessionId: string | null;
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
  if (options.action === 'commit') {
    return runGitCommit(options);
  }
  const check = evaluateGitGovernanceCheck({
    cwd: options.cwd,
    actorInput: options.actorId,
    taskId: options.taskId,
    sessionId: options.sessionId,
    requireTrailers: options.checkTrailers
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
      requiredTrailers: options.checkTrailers,
      actorId: check.actorId,
      taskId: check.taskId,
      claimLeaseId: check.claimLeaseId,
      sessionId: check.sessionId,
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
  sessionId?: string | null;
  requireTrailers: boolean;
}): GitGovernanceCheckResult {
  const cwd = path.resolve(input.cwd);
  const resolvedActor = resolveActorId(input.actorInput ?? undefined, cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', `git check requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const actorRecord = findActorByResolvedId(cwd, resolvedActor);
  const profile = resolveGitIdentityProfile(cwd, actorId, actorRecord);
  const gitName = readGitConfig(cwd, 'user.name');
  const gitEmail = readGitConfig(cwd, 'user.email');
  const taskDocument = input.taskId ? readTaskDocument(cwd, input.taskId) : null;
  const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
  const session = resolveActorWorkSession(cwd, {
    sessionId: input.sessionId ?? null,
    actorId,
    taskId: input.taskId,
    claimLeaseId: claim?.leaseId ?? null,
    includeNonActive: true
  });
  const trailers = parseTrailers(readHeadCommitMessage(cwd));

  const violations: GitGovernanceViolation[] = [];
  if (!profile.gitName || !profile.gitEmail) {
    violations.push({
      code: 'git-identity-profile-missing',
      detail: `Actor ${actorId} has no resolved git identity profile in actor registry or .atm/runtime/identity/default.json.`
    });
  }
  if (profile.gitName && gitName !== profile.gitName) {
    violations.push({
      code: 'git-name-mismatch',
      detail: `git user.name is ${gitName ?? 'unset'}, expected ${profile.gitName}.`
    });
  }
  if (profile.gitEmail && gitEmail !== profile.gitEmail) {
    violations.push({
      code: 'git-email-mismatch',
      detail: `git user.email is ${gitEmail ?? 'unset'}, expected ${profile.gitEmail}.`
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
  if (session && session.actorId !== actorId) {
    violations.push({
      code: 'session-actor-mismatch',
      detail: `Active session ${session.sessionId} belongs to ${session.actorId}, not ${actorId}.`
    });
  }
  if (session && input.taskId && session.taskId !== input.taskId) {
    violations.push({
      code: 'session-task-mismatch',
      detail: `Active session ${session.sessionId} is for ${session.taskId}, not ${input.taskId}.`
    });
  }
  if (session && claim?.leaseId && session.claimLeaseId && session.claimLeaseId !== claim.leaseId) {
    violations.push({
      code: 'session-claim-mismatch',
      detail: `Active session ${session.sessionId} is bound to claim ${session.claimLeaseId}, not ${claim.leaseId}.`
    });
  }

  if (input.requireTrailers) {
    requireTrailerValue(trailers, 'ATM-Actor', actorId, violations, 'trailer-actor-missing');
    if (input.taskId) {
      requireTrailerValue(trailers, 'ATM-Task', input.taskId, violations, 'trailer-task-missing');
    }
    if (claim?.leaseId) {
      requireTrailerValue(trailers, 'ATM-Claim', claim.leaseId, violations, 'trailer-claim-missing');
    }
    if (session?.sessionId) {
      requireTrailerValue(trailers, 'ATM-Session', session.sessionId, violations, 'trailer-session-missing');
    }
  }

  return {
    ok: violations.length === 0,
    actorId,
    taskId: input.taskId,
    claimLeaseId: claim?.leaseId ?? null,
    sessionId: session?.sessionId ?? null,
    gitName,
    gitEmail,
    trailers,
    violations
  };
}

function runGitPrepare(options: ParsedGitOptions) {
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', `git prepare requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const actorRecord = findActorByResolvedId(options.cwd, resolvedActor);
  const profile = resolveGitIdentityProfile(options.cwd, actorId, actorRecord);
  const nextName = options.gitName ?? profile.gitName ?? null;
  const nextEmail = options.gitEmail ?? profile.gitEmail ?? null;
  if (!nextName || !nextEmail) {
    throw new CliError('ATM_GIT_PREPARE_IDENTITY_MISSING', 'git prepare requires git name/email from actor registry, repo default identity, or explicit --name/--email.', {
      exitCode: 2,
      details: { actorId }
    });
  }

  writeGitConfig(options.cwd, 'user.name', nextName);
  writeGitConfig(options.cwd, 'user.email', nextEmail);

  const taskDocument = options.taskId ? readTaskDocument(options.cwd, options.taskId) : null;
  const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
  const session = resolveActorWorkSession(options.cwd, {
    sessionId: options.sessionId ?? null,
    actorId,
    taskId: options.taskId,
    claimLeaseId: claim?.leaseId ?? null,
    includeNonActive: true
  });
  const trailerHints = [
    `ATM-Actor: ${actorId}`,
    ...(options.taskId ? [`ATM-Task: ${options.taskId}`] : []),
    ...(claim?.leaseId ? [`ATM-Claim: ${claim.leaseId}`] : []),
    ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : []),
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
      sessionId: session?.sessionId ?? null,
      git: {
        name: nextName,
        email: nextEmail
      },
      trailerHints
    }
  });
}

function runGitCommit(options: ParsedGitOptions) {
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', `git commit requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
  }
  if (!options.message) {
    throw new CliError('ATM_CLI_USAGE', 'git commit requires --message <summary>.', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const actorRecord = findActorByResolvedId(options.cwd, resolvedActor);
  const profile = resolveGitIdentityProfile(options.cwd, actorId, actorRecord);
  if (!profile.gitName || !profile.gitEmail) {
    throw new CliError('ATM_GIT_COMMIT_IDENTITY_MISSING', 'git commit requires a resolved git identity profile. Run identity set or actor register first.', {
      exitCode: 2,
      details: { actorId }
    });
  }
  const taskDocument = options.taskId ? readTaskDocument(options.cwd, options.taskId) : null;
  const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
  const session = resolveActorWorkSession(options.cwd, {
    sessionId: options.sessionId ?? null,
    actorId,
    taskId: options.taskId,
    claimLeaseId: claim?.leaseId ?? null,
    includeNonActive: true
  });
  if (options.taskId && !session) {
    throw new CliError('ATM_GIT_COMMIT_SESSION_REQUIRED', `git commit requires an active or recent ATM work session for ${options.taskId}.`, {
      exitCode: 1,
      details: {
        actorId,
        taskId: options.taskId,
        requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${options.taskId}" --json`
      }
    });
  }
  const trailers = [
    `ATM-Actor: ${actorId}`,
    ...(options.taskId ? [`ATM-Task: ${options.taskId}`] : []),
    ...(claim?.leaseId ? [`ATM-Claim: ${claim.leaseId}`] : []),
    ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : [])
  ];
  const args = [
    'commit',
    ...(options.noVerify ? ['--no-verify'] : []),
    '--message',
    options.message,
    '--message',
    trailers.join('\n')
  ];
  try {
    execFileSync('git', args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: profile.gitName,
        GIT_AUTHOR_EMAIL: profile.gitEmail,
        GIT_COMMITTER_NAME: profile.gitName,
        GIT_COMMITTER_EMAIL: profile.gitEmail,
        ATM_COMMIT_ACTOR_ID: actorId,
        ATM_COMMIT_TASK_ID: options.taskId ?? '',
        ATM_COMMIT_CLAIM_LEASE_ID: claim?.leaseId ?? '',
        ATM_COMMIT_SESSION_ID: session?.sessionId ?? '',
        ATM_COMMIT_TRAILERS: trailers.join('\n')
      }
    });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String((error as any).stderr ?? '') : '';
    const stdout = error instanceof Error && 'stdout' in error ? String((error as any).stdout ?? '') : '';
    throw new CliError('ATM_GIT_COMMIT_FAILED', 'ATM git commit wrapper failed.', {
      exitCode: 1,
      details: {
        actorId,
        taskId: options.taskId,
        sessionId: session?.sessionId ?? null,
        stdout,
        stderr
      }
    });
  }
  const commitSha = readHeadCommitSha(options.cwd);
  return makeResult({
    ok: true,
    command: 'git',
    cwd: options.cwd,
    messages: [message('info', 'ATM_GIT_COMMIT_OK', 'ATM git commit wrapper created a commit with governed author and trailers.', {
      actorId,
      taskId: options.taskId,
      sessionId: session?.sessionId ?? null,
      commitSha
    })],
    evidence: {
      action: 'commit',
      actorId,
      taskId: options.taskId,
      claimLeaseId: claim?.leaseId ?? null,
      sessionId: session?.sessionId ?? null,
      commitSha,
      trailers,
      git: profile
    }
  });
}

interface ParsedGitOptions {
  readonly cwd: string;
  readonly action: 'prepare' | 'check' | 'commit';
  readonly actorId: string | null;
  readonly taskId: string | null;
  readonly gitName: string | null;
  readonly gitEmail: string | null;
  readonly sessionId: string | null;
  readonly message: string | null;
  readonly noVerify: boolean;
  readonly checkTrailers: boolean;
}

function parseGitOptions(argv: string[]): ParsedGitOptions {
  const options = {
    cwd: process.cwd(),
    action: null as ParsedGitOptions['action'] | null,
    actorId: null as string | null,
    taskId: null as string | null,
    gitName: null as string | null,
    gitEmail: null as string | null,
    sessionId: null as string | null,
    message: null as string | null,
    noVerify: false,
    checkTrailers: true
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
    if (arg === '--session') {
      options.sessionId = requireValue(argv, index, '--session');
      index += 1;
      continue;
    }
    if (arg === '--message') {
      options.message = requireValue(argv, index, '--message');
      index += 1;
      continue;
    }
    if (arg === '--no-verify') {
      options.noVerify = true;
      continue;
    }
    if (arg === '--no-trailers') {
      options.checkTrailers = false;
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
    if (arg !== 'prepare' && arg !== 'check' && arg !== 'commit') {
      throw new CliError('ATM_CLI_USAGE', 'git supports: prepare, check, commit', { exitCode: 2 });
    }
    options.action = arg;
  }
  if (!options.action) {
    throw new CliError('ATM_CLI_USAGE', 'git requires an action (prepare | check | commit).', { exitCode: 2 });
  }
  return {
    ...options,
    action: options.action,
    cwd: path.resolve(options.cwd)
  };
}

function resolveGitIdentityProfile(cwd: string, actorId: string, actorRecord: ReturnType<typeof findActorByResolvedId>): GitIdentityProfile {
  const defaultIdentity = readRuntimeIdentityDefault(cwd);
  if (actorRecord?.gitName || actorRecord?.gitEmail) {
    const defaultMatches = defaultIdentity?.actorId === actorId;
    return {
      gitName: actorRecord.gitName ?? (defaultMatches ? defaultIdentity?.gitName ?? null : null),
      gitEmail: actorRecord.gitEmail ?? (defaultMatches ? defaultIdentity?.gitEmail ?? null : null)
    };
  }
  if (defaultIdentity?.actorId === actorId) {
    return {
      gitName: defaultIdentity.gitName ?? null,
      gitEmail: defaultIdentity.gitEmail ?? null
    };
  }
  return {
    gitName: null,
    gitEmail: null
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

function readHeadCommitSha(cwd: string): string | null {
  try {
    const value = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return value || null;
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

function requireTrailerValue(
  trailers: Readonly<Record<string, readonly string[]>>,
  key: string,
  expectedValue: string,
  violations: GitGovernanceViolation[],
  code: string
) {
  const values = trailers[key] ?? [];
  if (!values.includes(expectedValue)) {
    violations.push({
      code,
      detail: `Latest commit is missing trailer ${key}: ${expectedValue}.`
    });
  }
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `git requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}
