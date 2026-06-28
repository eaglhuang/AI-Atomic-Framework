import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadValidatorFixture, materializeValidatorFixture } from './lib/validator-fixture.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = loadValidatorFixture(root, 'fixtures/validators/framework-governance-repairs.fixture.json');

function run(command: string, args: readonly string[], cwd: string, options: { allowFailure?: boolean } = {}) {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: process.env
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${command} ${args.join(' ')} failed\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function runGit(repo: string, args: readonly string[], options: { allowFailure?: boolean } = {}) {
  return run('git', args, repo, options);
}

function runCli(repo: string, args: readonly string[], options: { allowFailure?: boolean } = {}) {
  return run(process.execPath, ['atm.dev.mjs', ...args], repo, options);
}

function parsePayload(result: ReturnType<typeof run>) {
  const payload = (result.stdout || result.stderr || '').trim();
  return payload ? JSON.parse(payload) : {};
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-governance-repairs-'));
try {
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(repo, { recursive: true });
  materializeValidatorFixture(root, repo, fixture);

  runGit(repo, ['init']);
  runGit(repo, ['checkout', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(repo, ['config', 'user.name', 'ATM Governance Repair Validator']);

  assert.equal(parsePayload(runCli(repo, ['bootstrap', '--cwd', repo, '--json'])).ok, true);
  assert.equal(parsePayload(runCli(repo, ['atm-chart', 'render', '--cwd', repo, '--json'])).ok, true);
  assert.equal(parsePayload(runCli(repo, ['welcome', '--cwd', repo, '--json'])).ok, true);

  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '--no-verify', '-m', 'initial baseline']);

  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const frameworkRepairProbe = true;\n', 'utf8');
  runGit(repo, ['add', 'packages/core/src/index.ts']);
  const noHooksDir = path.join(tempRoot, 'no-hooks');
  mkdirSync(noHooksDir, { recursive: true });
  runGit(repo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'critical commit without git-head evidence']);

  const missingPush = runCli(repo, ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const missingPushPayload = parsePayload(missingPush);
  assert.equal(missingPush.status, 1, 'pre-push must fail before git-head backfill');
  assert.equal(missingPushPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_FAILED'), true);

  const headSha = String(runGit(repo, ['rev-parse', 'HEAD']).stdout || '').trim();
  const nowIso = new Date().toISOString();
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', 'git-head.jsonl');
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  const payload = {
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'commit',
        summary: 'Focused pre-push worktree backfill regression.',
        artifactPaths: [],
        createdAt: nowIso,
        producedBy: 'repair-validator',
        evidenceFreshness: 'fresh',
        commandRuns: [],
        details: {
          git: {
            commitSha: headSha,
            generatedAt: nowIso
          }
        }
      }
    ]
  };
  writeFileSync(evidencePath, `${JSON.stringify(payload)}\n`, 'utf8');

  const repairedPush = runCli(repo, ['hook', 'pre-push', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const repairedPushPayload = parsePayload(repairedPush);
  assert.equal(repairedPush.status, 0, 'pre-push must accept worktree-local git-head backfill for current HEAD');
  assert.equal(repairedPushPayload.messages.some((entry: any) => entry.code === 'ATM_HOOK_PRE_PUSH_OK'), true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[framework-governance-repairs:validate] ok');
