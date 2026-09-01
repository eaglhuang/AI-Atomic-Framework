import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectGitDiffMutationRequests } from '../../../core/dist/git/index.js';
const atmPrePushHookMarker = 'ATM_GIT_PRE_PUSH_HOOK_V1';
const atmPrePushHookScriptVersion = '0.1.0';
const atmPrePushHookOutputJsonRelativePath = '.atm/runtime/pre-push-hook-last.json';
const atmPrePushHookManifestFileName = 'pre-push.atm-manifest.json';
const atmPrePushHookBackupFileName = 'pre-push.atm-backup';
export function resolveGitDiffMutationRequests(options) {
    return collectGitDiffMutationRequests(options);
}
export function installAtmPrePushHook(cwd, options = {}) {
    const repoRoot = resolveRepoRoot(cwd);
    const hookPath = resolveGitPath(repoRoot, 'hooks/pre-push');
    const manifestPath = resolveGitPath(repoRoot, `hooks/${atmPrePushHookManifestFileName}`);
    const backupPath = resolveGitPath(repoRoot, `hooks/${atmPrePushHookBackupFileName}`);
    const outputJsonPath = path.join(repoRoot, atmPrePushHookOutputJsonRelativePath);
    const script = buildAtmPrePushHookScript();
    const installed = existsSync(hookPath);
    const currentText = installed ? readFileSync(hookPath, 'utf8') : null;
    const alreadyInstalled = Boolean(currentText && currentText.includes(atmPrePushHookMarker));
    const shouldWrite = options.dryRun !== true && (!alreadyInstalled || options.force === true);
    if (shouldWrite) {
        mkdirSync(path.dirname(hookPath), { recursive: true });
        mkdirSync(path.dirname(outputJsonPath), { recursive: true });
        if (installed && !alreadyInstalled && !existsSync(backupPath)) {
            writeFileSync(backupPath, currentText ?? '', 'utf8');
        }
        writeFileSync(hookPath, script, 'utf8');
        writeFileSync(manifestPath, `${JSON.stringify({
            schemaId: 'atm.gitPrePushHookInstall.v1',
            specVersion: '0.1.0',
            repoRoot,
            hookPath: toRepoRelative(repoRoot, hookPath),
            backupPath: existsSync(backupPath) ? toRepoRelative(repoRoot, backupPath) : null,
            outputJsonPath: atmPrePushHookOutputJsonRelativePath,
            installedAt: new Date().toISOString()
        }, null, 2)}\n`, 'utf8');
    }
    return {
        ok: true,
        hookPath: toRepoRelative(repoRoot, hookPath),
        backupPath: existsSync(backupPath) ? toRepoRelative(repoRoot, backupPath) : null,
        manifestPath: toRepoRelative(repoRoot, manifestPath),
        outputJsonPath: atmPrePushHookOutputJsonRelativePath,
        manualInstall: buildManualInstallInstructions(),
        alreadyInstalled,
        restoredPreviousHookPossible: existsSync(backupPath),
        scriptPreview: script
    };
}
export function verifyAtmPrePushHook(cwd) {
    const repoRoot = resolveRepoRoot(cwd);
    const hookPath = resolveGitPath(repoRoot, 'hooks/pre-push');
    const manifestPath = resolveGitPath(repoRoot, `hooks/${atmPrePushHookManifestFileName}`);
    const installed = existsSync(hookPath);
    const text = installed ? readFileSync(hookPath, 'utf8') : '';
    const delegatesToAtmCli = text.includes('node atm.mjs hook pre-push --summary --json');
    const summaryProjectionEnabled = text.includes('--summary --json');
    const outputJsonConfigured = text.includes(`REPORT_PATH="${atmPrePushHookOutputJsonRelativePath}"`)
        && text.includes('--output-json "$REPORT_PATH"');
    return {
        ok: installed
            && text.includes(atmPrePushHookMarker)
            && delegatesToAtmCli
            && outputJsonConfigured,
        hookPath: toRepoRelative(repoRoot, hookPath),
        manifestPath: toRepoRelative(repoRoot, manifestPath),
        outputJsonPath: atmPrePushHookOutputJsonRelativePath,
        installed,
        markerPresent: text.includes(atmPrePushHookMarker),
        delegatesToAtmCli,
        summaryProjectionEnabled,
        outputJsonConfigured,
        manualInstall: buildManualInstallInstructions()
    };
}
export function uninstallAtmPrePushHook(cwd, options = {}) {
    const repoRoot = resolveRepoRoot(cwd);
    const hookPath = resolveGitPath(repoRoot, 'hooks/pre-push');
    const manifestPath = resolveGitPath(repoRoot, `hooks/${atmPrePushHookManifestFileName}`);
    const backupPath = resolveGitPath(repoRoot, `hooks/${atmPrePushHookBackupFileName}`);
    if (!existsSync(hookPath)) {
        return {
            ok: true,
            hookPath: toRepoRelative(repoRoot, hookPath),
            manifestPath: toRepoRelative(repoRoot, manifestPath),
            backupPath: existsSync(backupPath) ? toRepoRelative(repoRoot, backupPath) : null,
            restoredBackup: false,
            removedAtmHook: false,
            reason: 'no-hook-installed'
        };
    }
    const text = readFileSync(hookPath, 'utf8');
    if (!text.includes(atmPrePushHookMarker)) {
        return {
            ok: true,
            hookPath: toRepoRelative(repoRoot, hookPath),
            manifestPath: toRepoRelative(repoRoot, manifestPath),
            backupPath: existsSync(backupPath) ? toRepoRelative(repoRoot, backupPath) : null,
            restoredBackup: false,
            removedAtmHook: false,
            reason: 'hook-not-managed-by-atm'
        };
    }
    const restoredBackup = existsSync(backupPath);
    if (options.dryRun !== true) {
        if (restoredBackup) {
            writeFileSync(hookPath, readFileSync(backupPath, 'utf8'), 'utf8');
            rmSync(backupPath, { force: true });
        }
        else {
            rmSync(hookPath, { force: true });
        }
        rmSync(manifestPath, { force: true });
    }
    return {
        ok: true,
        hookPath: toRepoRelative(repoRoot, hookPath),
        manifestPath: toRepoRelative(repoRoot, manifestPath),
        backupPath: restoredBackup ? toRepoRelative(repoRoot, backupPath) : null,
        restoredBackup,
        removedAtmHook: true,
        reason: restoredBackup ? null : 'removed-atm-hook-without-backup'
    };
}
function buildManualInstallInstructions() {
    return [
        'Copy the generated shell script into `.git/hooks/pre-push`.',
        'Make the file executable, for example: `chmod +x .git/hooks/pre-push`.',
        'The hook delegates to `node atm.mjs hook pre-push --summary --json` and writes the full report to `.atm/runtime/pre-push-hook-last.json`.'
    ];
}
function buildAtmPrePushHookScript() {
    return [
        '#!/bin/sh',
        `# ${atmPrePushHookMarker}`,
        `# version=${atmPrePushHookScriptVersion}`,
        `REPORT_PATH="${atmPrePushHookOutputJsonRelativePath}"`,
        'node atm.mjs hook pre-push --summary --json --output-json "$REPORT_PATH"',
        'STATUS=$?',
        'if [ "$STATUS" -ne 0 ]; then',
        '  echo "ATM pre-push blocked. See $REPORT_PATH for the full report." 1>&2',
        'fi',
        'exit "$STATUS"',
        ''
    ].join('\n');
}
function resolveRepoRoot(cwd) {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}
function resolveGitPath(repoRoot, relativeGitPath) {
    const gitResolved = execFileSync('git', ['rev-parse', '--git-path', relativeGitPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return path.isAbsolute(gitResolved)
        ? gitResolved
        : path.resolve(repoRoot, gitResolved);
}
function toRepoRelative(repoRoot, targetPath) {
    return path.relative(repoRoot, targetPath).replace(/\\/g, '/');
}
