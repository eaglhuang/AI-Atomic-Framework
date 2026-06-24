import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIntegration } from '../../packages/cli/src/commands/integration.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.resolve(root, '.atm-temp-test-git-pre-push-hook');

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function writeText(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function setupRepo(name: string) {
  const repoRoot = path.join(tempRoot, name);
  rmSync(repoRoot, { recursive: true, force: true });
  mkdirSync(repoRoot, { recursive: true });
  runGit(repoRoot, ['init', '--initial-branch=main']);
  runGit(repoRoot, ['config', 'user.name', 'fixture-agent']);
  runGit(repoRoot, ['config', 'user.email', 'fixture-agent@example.com']);
  writeText(path.join(repoRoot, 'README.md'), '# fixture\n');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-m', 'chore: bootstrap']);
  return repoRoot;
}

async function runHookCommand(repoRoot: string, args: string[]) {
  return runIntegration([
    'hooks',
    ...args,
    '--cwd', repoRoot,
    '--json'
  ]);
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  {
    const repoRoot = setupRepo('install-verify-uninstall');
    const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-push');
    const manifestPath = path.join(repoRoot, '.git', 'hooks', 'pre-push.atm-manifest.json');
    const backupPath = path.join(repoRoot, '.git', 'hooks', 'pre-push.atm-backup');
    writeText(hookPath, '#!/bin/sh\necho legacy-pre-push\n');

    const install = await runHookCommand(repoRoot, ['install', 'git-pre-push']);
    assert.equal(install.ok, true);
    assert.equal(install.messages[0]?.code, 'ATM_GIT_PRE_PUSH_HOOK_INSTALLED');
    assert.equal(existsSync(hookPath), true);
    assert.equal(existsSync(manifestPath), true);
    assert.equal(existsSync(backupPath), true);

    const installedHook = readFileSync(hookPath, 'utf8');
    assert.match(installedHook, /ATM_GIT_PRE_PUSH_HOOK_V1/);
    assert.match(installedHook, /node atm\.mjs hook pre-push --summary --json --output-json "\$REPORT_PATH"/);
    assert.match(installedHook, /See \$REPORT_PATH for the full report/);
    const installReport = (install.evidence as any).report;
    assert.deepEqual(installReport.manualInstall, [
      'Copy the generated shell script into `.git/hooks/pre-push`.',
      'Make the file executable, for example: `chmod +x .git/hooks/pre-push`.',
      'The hook delegates to `node atm.mjs hook pre-push --summary --json` and writes the full report to `.atm/runtime/pre-push-hook-last.json`.'
    ]);

    const verify = await runHookCommand(repoRoot, ['verify', 'git-pre-push']);
    assert.equal(verify.ok, true);
    assert.equal(verify.messages[0]?.code, 'ATM_GIT_PRE_PUSH_HOOK_VERIFY_OK');
    const verifyReport = (verify.evidence as any).report;
    assert.equal(verifyReport.installed, true);
    assert.equal(verifyReport.markerPresent, true);
    assert.equal(verifyReport.delegatesToAtmCli, true);
    assert.equal(verifyReport.summaryProjectionEnabled, true);
    assert.equal(verifyReport.outputJsonConfigured, true);

    const uninstall = await runHookCommand(repoRoot, ['uninstall', 'git-pre-push']);
    assert.equal(uninstall.ok, true);
    assert.equal(uninstall.messages[0]?.code, 'ATM_GIT_PRE_PUSH_HOOK_UNINSTALLED');
    assert.equal(readFileSync(hookPath, 'utf8'), '#!/bin/sh\necho legacy-pre-push\n');
    assert.equal(existsSync(manifestPath), false);
    assert.equal(existsSync(backupPath), false);
    const uninstallReport = (uninstall.evidence as any).report;
    assert.equal(uninstallReport.restoredBackup, true);
    assert.equal(uninstallReport.removedAtmHook, true);
  }

  {
    const repoRoot = setupRepo('missing-hook');
    const verify = await runHookCommand(repoRoot, ['verify', 'git-pre-push']);
    assert.equal(verify.ok, false);
    assert.equal(verify.messages[0]?.code, 'ATM_GIT_PRE_PUSH_HOOK_VERIFY_FAILED');
    assert.equal((verify.evidence as any).report.installed, false);

    const uninstall = await runHookCommand(repoRoot, ['uninstall', 'git-pre-push']);
    assert.equal(uninstall.ok, true);
    assert.equal((uninstall.evidence as any).report.reason, 'no-hook-installed');
    assert.equal((uninstall.evidence as any).report.removedAtmHook, false);
  }

  {
    const repoRoot = setupRepo('drifted-hook');
    const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-push');
    writeText(hookPath, '#!/bin/sh\necho bypassed-hook\n');

    const verify = await runHookCommand(repoRoot, ['verify', 'git-pre-push']);
    assert.equal(verify.ok, false);
    assert.equal(verify.messages[0]?.code, 'ATM_GIT_PRE_PUSH_HOOK_VERIFY_FAILED');
    const report = (verify.evidence as any).report;
    assert.equal(report.installed, true);
    assert.equal(report.markerPresent, false);
    assert.equal(report.delegatesToAtmCli, false);
    assert.equal(report.outputJsonConfigured, false);
  }

  console.log('[git-pre-push-hook-installer] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
