import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';
import { buildTaskflowOpenCommand } from '../../packages/cli/src/commands/taskflow/open-command.ts';
import { BUILTIN_TASKFLOW_OPENER } from '../../packages/cli/src/commands/taskflow/profile-loader.ts';
import { getCommandSpec } from '../../packages/cli/src/commands/command-specs.ts';
import { parseArgsForCommand } from '../../packages/cli/src/commands/shared.ts';

type Hint = { status: string; nextCommand: string | null; nextCommandShell?: string; missingPrerequisites: string[] };
type OpenResult = { ok: boolean; writeEnabled: boolean; writeReadinessHint: Hint; messages: { code: string; data?: { requiredCommand?: string } }[]; evidence: { writeReadinessHint: Hint; nextAction?: { status: string; command: string }; hostPolicyDecision?: { taskId: string; outputPath: string } } };

function fixture(t: TestContext, builtin = false) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-open-command-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const profile = JSON.parse(readFileSync(new URL('../../fixtures/taskflow-profile/governed-invocable.profile.json', import.meta.url), 'utf8'));
  profile.delegation.policy.rosterSyncPolicy = 'none';
  if (builtin) profile.delegation.openerPath = BUILTIN_TASKFLOW_OPENER;
  const profilePath = path.join(cwd, 'taskflow.profile.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  mkdirSync(path.join(cwd, '.atm'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm/config.json'), JSON.stringify({
    schemaVersion: 'atm.config.v0.1', layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', provider: 'atm-local', mirrorExternalTasks: true, requireCliTransitions: true }
  }));
  return { cwd, profilePath };
}

// An independent, non-executing tokenizer for the formatter's POSIX subset.
// Never pass a returned hint to a shell, eval, or a command executor.
function literalTokens(command: string): string[] {
  const tokens: string[] = [];
  let value = '', quoted = false, started = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quoted) {
      if (char === "'") quoted = false;
      else value += char;
      continue;
    }
    if (char === "'") { quoted = true; started = true; }
    else if (char === '\\') { assert.ok(i + 1 < command.length); value += command[++i]; started = true; }
    else if (/\s/.test(char)) { if (started) { tokens.push(value); value = ''; started = false; } }
    else { assert.match(char, /[A-Za-z0-9_./-]/, 'metacharacters must not be unquoted'); value += char; started = true; }
  }
  assert.equal(quoted, false);
  if (started) tokens.push(value);
  return tokens;
}

function tokensFor(argv: readonly string[]) {
  const hint = buildTaskflowOpenCommand(argv);
  assert.equal(hint.shell, 'posix-sh');
  assert.equal(hint.reason, null);
  assert.ok(hint.command);
  return literalTokens(hint.command);
}

function seedGit(cwd: string, commit = true) {
  // Fixed trusted argv, exclusively within this test's new temporary fixture.
  execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
  if (commit) execFileSync('git', ['-c', 'user.name=ATM Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd, stdio: 'ignore' });
}

async function open(argv: string[]): Promise<OpenResult> {
  return await runTaskflow(argv) as unknown as OpenResult;
}

test('open dry-run retains explicitly supplied owner, scope and validator in its write hint', async t => {
  const { cwd, profilePath } = fixture(t, true);
  const argv = ['open', '--dry-run', '--cwd', cwd, '--profile', profilePath,
    '--actor', 'newcomer', '--scope-path', 'hello.txt', '--validator', 'test -f hello.txt', '--json'];
  const before = [...argv];
  const result = await open(argv);
  assert.ok(result.writeReadinessHint.nextCommand);
  assert.match(result.writeReadinessHint.nextCommand, /--actor/);
  assert.match(result.writeReadinessHint.nextCommand, /--scope-path/);
  assert.match(result.writeReadinessHint.nextCommand, /--validator/);
  assert.equal(result.writeReadinessHint.nextCommandShell, 'posix-sh');
  assert.deepEqual(result.writeReadinessHint, result.evidence.writeReadinessHint);
  assert.deepEqual(argv, before);
  assert.equal(existsSync(path.join(cwd, '.atm/history/tasks')), false, 'dry-run writes no task');
});

test('all explicit open flags and repeated scalar flags survive without changing last-value-wins semantics', async t => {
  const { cwd, profilePath } = fixture(t);
  const pairs = ['--cwd', cwd, '--profile', profilePath, '--actor', 'first', '--actor', 'second',
    '--task-id', 'TASK-GOVERNED-0007', '--output', 'docs/tasks/TASK-GOVERNED-0007.task.md',
    '--template', 'adopter-task', '--goal', 'Keep the exact goal', '--scope-path', 'old.txt',
    '--scope-path', 'src/a.ts,src/b.ts', '--validator', 'first check', '--validator', 'node tests/check.ts',
    '--title', 'A bounded task', '--roster-index', 'docs/tasks/index.md'];
  const argv = ['open', '--dry-run', ...pairs, '--json'];
  const tokens = tokensFor(argv);
  assert.deepEqual(tokens, ['node', 'atm.mjs', 'taskflow', 'open', '--write', ...pairs, '--json']);
  const result = await open(argv);
  assert.deepEqual(literalTokens(result.writeReadinessHint.nextCommand!), tokens);
  const spec = getCommandSpec('taskflow'); assert.ok(spec);
  const original = parseArgsForCommand(spec, argv).options;
  const recovered = parseArgsForCommand(spec, tokens.slice(3)).options;
  for (const key of ['cwd', 'profile', 'actor', 'taskId', 'output', 'template', 'goal', 'scopePath', 'validator', 'title', 'rosterIndex']) {
    assert.equal(recovered[key], original[key], key);
  }
  assert.equal(recovered.actor, 'second');
  assert.equal(recovered.scopePath, 'src/a.ts,src/b.ts');
  assert.equal(recovered.validator, 'node tests/check.ts');
  assert.equal(tokens.filter(value => value === '--write').length, 1);
  assert.equal(tokens.filter(value => value === '--json').length, 1);
  assert.equal(tokens.includes('--dry-run'), false);
});

test('POSIX literal serialization covers whitespace, quotes and expansion syntax without executing it', () => {
  const values = ['two words', 'tab\tvalue', "a'b", 'a"b', 'a\\b', '尾端\\', '繁體中文 😀',
    '$HOME', '$(touch NEVER_EXECUTE)', '`touch NEVER_EXECUTE`', '; touch NEVER_EXECUTE', 'a&b', 'a|b',
    'a>b', 'a<b', '#comment', '*?[abc]', '(subshell)', '{a,b}', 'a,b', 'line1\nline2', 'line1\r\nline2'];
  for (const value of values) {
    const argv = ['open', '--title', value];
    assert.deepEqual(tokensFor(argv), ['node', 'atm.mjs', 'taskflow', 'open', '--write', '--title', value, '--json']);
    const spec = getCommandSpec('taskflow'); assert.ok(spec);
    assert.equal(parseArgsForCommand(spec, tokensFor(argv).slice(3)).options.title, value);
  }
  assert.equal(buildTaskflowOpenCommand(['open', '--title', "a'b"]).command,
    "node atm.mjs taskflow open --write --title 'a'\\''b' --json");
});

test('unrepresentable values fail closed without echoing the input or broadening CLI syntax', () => {
  for (const value of ['', '--another-option', 'bad\0value']) {
    assert.deepEqual(buildTaskflowOpenCommand(['open', '--title', value]),
      { command: null, shell: 'posix-sh', reason: 'unrepresentable-value' });
  }
  assert.equal(buildTaskflowOpenCommand(['open', '--title']).command, null);
});

test('credential-bearing values suppress the entire hint instead of producing a redacted executable command', async t => {
  for (const value of ['API_TOKEN=synthetic-only', 'PASSWORD=synthetic-only', 'tool --api-key synthetic-only',
    'Authorization: Bearer synthetic-only', 'https://user:synthetic-only@example.invalid',
    'key: -----BEGIN PRIVATE KEY-----']) {
    const hint = buildTaskflowOpenCommand(['open', '--validator', value]);
    assert.equal(hint.command, null);
    assert.equal(hint.reason, 'credential-bearing-value');
    assert.equal(JSON.stringify(hint).includes(value), false);
  }
  const { cwd, profilePath } = fixture(t, true);
  const result = await open(['open', '--dry-run', '--cwd', cwd, '--profile', profilePath,
    '--actor', 'newcomer', '--scope-path', 'hello.txt', '--validator', 'API_TOKEN=synthetic-only']);
  assert.equal(result.writeReadinessHint.status, 'incomplete');
  assert.equal(result.writeReadinessHint.nextCommand, null);
  assert.equal(JSON.stringify(result.writeReadinessHint).includes('synthetic-only'), false);
});

test('ordinary authentication prose is not mistaken for a credential', () => {
  for (const value of ['Add basic authentication', 'Show bearer token documentation', 'Document authorization headers']) {
    for (const flag of ['--title', '--goal']) {
      assert.deepEqual(tokensFor(['open', flag, value]),
        ['node', 'atm.mjs', 'taskflow', 'open', '--write', flag, value, '--json']);
    }
  }
});

test('only explicit open inputs are copied, without close authority or host-allocated defaults', async t => {
  const argv = ['open', '--dry-run', '--task', 'CLOSE-ONLY', '--historical-delivery', 'abc123',
    '--emergency-approval', 'private-lease', '--reason', 'private reason', '--defer-foreign-state',
    '--no-commit', '--auto-evidence', '--pretty', '--summary', '--fields', 'ok'];
  assert.deepEqual(tokensFor(argv), ['node', 'atm.mjs', 'taskflow', 'open', '--write', '--json']);
  const { cwd, profilePath } = fixture(t);
  const result = await open(['open', '--dry-run', '--cwd', cwd, '--profile', profilePath]);
  assert.equal(result.writeReadinessHint.status, 'ready', 'custom host opener does not acquire built-in-only requirements');
  assert.ok(result.evidence.hostPolicyDecision?.taskId);
  const tokens = literalTokens(result.writeReadinessHint.nextCommand!);
  for (const flag of ['--actor', '--scope-path', '--validator', '--task-id', '--output', '--title', '--template']) {
    assert.equal(tokens.includes(flag), false, flag);
  }
  const noProfile = mkdtempSync(path.join(os.tmpdir(), 'atm-open-no-profile-'));
  t.after(() => rmSync(noProfile, { recursive: true, force: true }));
  const fallback = await open(['open', '--cwd', noProfile, '--dry-run']);
  assert.equal(fallback.writeReadinessHint.status, 'fallback');
  assert.equal(fallback.writeReadinessHint.nextCommand, null);
});

test('existing built-in required fields and Git-base refusals remain authoritative', async t => {
  const savedActor = process.env.ATM_ACTOR_ID;
  delete process.env.ATM_ACTOR_ID;
  t.after(() => { if (savedActor === undefined) delete process.env.ATM_ACTOR_ID; else process.env.ATM_ACTOR_ID = savedActor; });
  for (const missing of ['--actor', '--scope-path', '--validator']) {
    const { cwd, profilePath } = fixture(t, true); seedGit(cwd);
    const options = ['--actor', 'newcomer', '--scope-path', './hello.txt', '--validator', 'test -f hello.txt'];
    options.splice(options.indexOf(missing), 2);
    await assert.rejects(() => open(['open', '--write', '--cwd', cwd, '--profile', profilePath, ...options]),
      (error: unknown) => (error as { code?: string }).code === 'ATM_CLI_USAGE');
    assert.equal(existsSync(path.join(cwd, '.atm/history/tasks')), false);
  }
  for (const emptyGit of [false, true]) {
    const { cwd, profilePath } = fixture(t, true); if (emptyGit) seedGit(cwd, false);
    await assert.rejects(() => open(['open', '--write', '--cwd', cwd, '--profile', profilePath,
      '--actor', 'newcomer', '--scope-path', './hello.txt', '--validator', 'test -f hello.txt']),
      (error: unknown) => (error as { code?: string }).code === 'ATM_TASKFLOW_OPEN_GIT_BASE_MISSING');
    assert.equal(existsSync(path.join(cwd, '.atm/history/tasks')), false);
  }
});

test('a separately constructed trusted built-in write still preserves scope normalization', async t => {
  const { cwd, profilePath } = fixture(t, true); seedGit(cwd);
  const result = await open(['open', '--write', '--cwd', cwd, '--profile', profilePath,
    '--actor', 'newcomer', '--scope-path', './hello.txt', '--validator', 'test -f hello.txt', '--title', 'Trusted fixture']);
  assert.equal(result.ok, true);
  const task = JSON.parse(readFileSync(path.join(cwd, '.atm/history/tasks/TASK-GOVERNED-0001.json'), 'utf8'));
  assert.deepEqual(task.scopePaths, ['hello.txt']);
  const claimCommand = result.evidence.nextAction?.command;
  assert.equal(result.evidence.nextAction?.status, 'task-opened');
  assert.ok(claimCommand);
  assert.match(claimCommand, /^node atm\.mjs next --claim /);
  assert.match(claimCommand, /--task TASK-GOVERNED-0001 --json$/);
  assert.equal(result.evidence.writeReadinessHint.nextCommand, claimCommand);
  assert.equal(result.messages.find(message => message.code === 'ATM_TASKFLOW_OPEN_WRITE_ORCHESTRATED')?.data?.requiredCommand, claimCommand);
  assert.equal(result.writeReadinessHint.nextCommandShell, undefined);
  assert.equal(result.evidence.writeReadinessHint.nextCommandShell, undefined);
});

test('dry-run formatter suppression and shell metadata do not describe upstream post-open claim hints', async t => {
  const { cwd, profilePath } = fixture(t, true); seedGit(cwd);
  const args = ['--cwd', cwd, '--profile', profilePath, '--actor', 'newcomer',
    '--scope-path', './hello.txt', '--validator', 'test -f hello.txt', '--title', 'API_TOKEN=synthetic-only'];
  const preview = await open(['open', '--dry-run', ...args]);
  assert.equal(preview.writeReadinessHint.nextCommand, null);
  assert.equal(preview.writeReadinessHint.status, 'incomplete');
  assert.equal(preview.writeReadinessHint.nextCommandShell, 'posix-sh');
  // Construct trusted fixture argv separately; never execute a returned hint.
  const written = await open(['open', '--write', ...args]);
  assert.equal(written.ok, true);
  assert.equal(written.evidence.nextAction?.status, 'task-opened');
  assert.equal(written.evidence.writeReadinessHint.status, 'ready');
  assert.deepEqual(written.evidence.writeReadinessHint.missingPrerequisites, []);
  assert.equal(written.evidence.writeReadinessHint.nextCommand, written.evidence.nextAction?.command);
  assert.equal(written.evidence.writeReadinessHint.nextCommandShell, undefined);
  assert.equal(written.writeReadinessHint.nextCommandShell, undefined);
  assert.equal(JSON.stringify(written.evidence.writeReadinessHint).includes('synthetic-only'), false);
});
