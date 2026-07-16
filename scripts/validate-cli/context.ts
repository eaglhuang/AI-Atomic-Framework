import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { quoteForShell, detectAutoLinkedValidator } from '../../packages/cli/src/commands/evidence.ts';
import { createTempWorkspace, initializeGitRepository } from '../temp-root.ts';
import { cliCommandRunners, runCli } from '../../packages/cli/src/atm.ts';
import { commandSpecs, listCommandSpecs } from '../../packages/cli/src/commands/command-specs.ts';
import { resolveTaskScopedCommitBundle } from '../../packages/cli/src/commands/git-governance.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export type ValidateCliOptions = {
  mode: string;
  profile: string | null;
  fastOnly: boolean;
  surfaceOnly: boolean;
  childProcessSmokeEnabled: boolean;
};

export type ValidateCliContext = ReturnType<typeof createValidateCliContext>;

export function parseOptions(argv: string[]): ValidateCliOptions {
  const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'validate';
  const profile = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : null;
  return {
    mode,
    profile,
    fastOnly: mode === 'fast' || profile === 'fast' || argv.includes('--fast'),
    surfaceOnly: mode === 'surface' || profile === 'surface' || argv.includes('--surface'),
    childProcessSmokeEnabled: process.env.ATM_VALIDATE_CLI_CHILD_SMOKE !== '0'
  };
}

export function scrubAmbientEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ATM_') && !['ATM_VALIDATE_CLI_CHILD_SMOKE', 'ATM_TEMP_ROOT'].includes(key)) {
      delete process.env[key];
    }
  }
  for (const key of ['AGENT_IDENTITY', 'ATM_EDITOR_ID', 'CODEX_HOME']) {
    delete process.env[key];
  }
  for (const key of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']) {
    delete process.env[key];
  }
}

export function createValidateCliContext(options: ValidateCliOptions) {
  const startedAt = Date.now();
  let currentProgressPhase = 'initializing fixtures';
  const progressHeartbeat = setInterval(() => {
    console.error(`[cli:${options.mode}] still running: ${currentProgressPhase} (${formatDuration(Date.now() - startedAt)} elapsed)`);
  }, 30000);
  progressHeartbeat.unref();

  const fixture = readJson('tests/cli-fixtures/cli-mvp.fixture.json');
  const helpCommandSnapshot = readJson('tests/cli-fixtures/help-snapshots/command-list.json');
  const perCommandHelpSnapshots = {
    explain: readJson('tests/cli-fixtures/help-snapshots/explain.json'),
    broker: readJson('tests/cli-fixtures/help-snapshots/broker.json'),
    next: readJson('tests/cli-fixtures/help-snapshots/next.json'),
    orient: readJson('tests/cli-fixtures/help-snapshots/orient.json'),
    start: readJson('tests/cli-fixtures/help-snapshots/start.json'),
    guide: readJson('tests/cli-fixtures/help-snapshots/guide.json'),
    registry: readJson('tests/cli-fixtures/help-snapshots/registry.json'),
    upgrade: readJson('tests/cli-fixtures/help-snapshots/upgrade.json')
  };
  const publicCommandNames = listCommandSpecs().map((spec: any) => spec.name).sort((left: any, right: any) => left.localeCompare(right));
  const internalCommandNames = Object.values(commandSpecs)
    .filter((spec: any) => spec.visibility === 'internal')
    .map((spec: any) => spec.name)
    .sort((left: any, right: any) => left.localeCompare(right));
  const runnerCommandNames = Object.keys(cliCommandRunners).sort((left, right) => left.localeCompare(right));
  const allSpecCommandNames = Object.keys(commandSpecs).sort((left, right) => left.localeCompare(right));
  const aao0063TaskFixturePath = path.join(root, 'scripts/fixtures/tasks/TASK-AAO-0063-evidence-required-command-quoting-validator-auto-link.fixture.md');

  function logProgress(phase: string) {
    currentProgressPhase = phase;
    console.error(`[cli:${options.mode}] phase: ${phase} (${formatDuration(Date.now() - startedAt)} elapsed)`);
  }

  return {
    ...options,
    startedAt,
    progressHeartbeat,
    fixture,
    helpCommandSnapshot,
    perCommandHelpSnapshots,
    publicCommandNames,
    internalCommandNames,
    runnerCommandNames,
    allSpecCommandNames,
    aao0063TaskFixturePath,
    logProgress
  };
}

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

export function fail(message: any) {
  console.error(String(message));
  process.exitCode = 1;
}

export function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

export function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

export function writeJson(filePath: any, value: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function safeRmSync(targetPath: string) {
  const retryableCodes = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
  let lastError: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException | undefined;
      if (!candidate?.code || !retryableCodes.has(candidate.code)) throw error;
      lastError = candidate;
      if (attempt < 5) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
    }
  }
  console.warn(`warning: cleanup skipped for ${targetPath} (${lastError?.code ?? 'unknown'})`);
}

export async function runAtm(args: any, cwd = root, env: Record<string, string> = {}) {
  const previousCwd = process.cwd();
  const previousEnv = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  let stdout = '';
  let stderr = '';
  try {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    const exitCode = await runCli(args, {
      stdout: { write(chunk: unknown) { stdout += String(chunk); return true; } } as any,
      stderr: { write(chunk: unknown) { stderr += String(chunk); return true; } } as any
    });
    return { exitCode, stdout, stderr, parsed: parseCliJsonFromStreams(stdout, stderr, args) };
  } finally {
    process.chdir(previousCwd);
    for (const [key, value] of previousEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

export async function runAtmSpawned(args: any, cwd = root, env: Record<string, string> = {}) {
  const fixture = readJson('tests/cli-fixtures/cli-mvp.fixture.json');
  const result = spawnSync(process.execPath, [path.join(root, fixture.entrypoint), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
    return runAtm(args, cwd, env);
  }
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: parseCliJsonFromStreams(result.stdout ?? '', result.stderr ?? '', args)
  };
}

export function parseCliJsonFromStreams(stdout: string, stderr: string, args: any) {
  const attempts = [stdout.trim(), stderr.trim(), `${stdout}\n${stderr}`.trim()].filter(Boolean);
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {}
    const jsonStart = candidate.indexOf('{');
    const jsonEnd = candidate.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        return JSON.parse(candidate.slice(jsonStart, jsonEnd + 1));
      } catch {}
    }
  }
  fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${(stdout || stderr).trim()}`);
  return {};
}

export function assertReadable(result: any, commandName: any) {
  for (const field of readJson('tests/cli-fixtures/cli-mvp.fixture.json').agentReadableFields) {
    assert(Object.hasOwn(result.parsed, field), `${commandName} output missing field: ${field}`);
  }
  assert(Array.isArray(result.parsed.messages), `${commandName} messages must be an array`);
  assert(result.parsed.evidence && typeof result.parsed.evidence === 'object', `${commandName} evidence must be an object`);
}

export function assertMessageCode(result: any, code: any) {
  assert(result.parsed.messages.some((entry: any) => entry.code === code), `expected message code ${code}`);
}

export function createCliTempWorkspace(prefix: string) {
  return createTempWorkspace(prefix);
}

export { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, path, spawn, spawnSync, createHash, quoteForShell, detectAutoLinkedValidator, initializeGitRepository, resolveTaskScopedCommitBundle };
