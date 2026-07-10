import { makeResult, message } from './shared.ts';
import { parseHookArgs, runPrePushHook } from './hook/pre-push.ts';
import { runPreCommitHook, inspectProtectedAtmStateChanges } from './hook/pre-commit.ts';
import {
  hookContractVersion,
  hookMarker,
  hookProvider,
  inspectGitHooks,
  installGitHooks,
  parseGitHooksArgs,
  type GitHookInspectionReport,
  type HookFileInspection
} from './hook/git-hooks-installer.ts';
import { createCommitRangeGuardReport, parseCommitRangeArgs } from './hook/commit-range-guard.ts';

export {
  hookContractVersion,
  hookMarker,
  hookProvider,
  inspectGitHooks,
  installGitHooks,
  inspectProtectedAtmStateChanges
};
export type { GitHookInspectionReport, HookFileInspection };

export function runHook(argv: string[]) {
  const options = parseHookArgs(argv);
  if (options.action === 'pre-commit') {
    return runPreCommitHook(options.cwd);
  }
  return runPrePushHook(options.cwd, options.base, options.head);
}

export function runGitHooks(argv: string[]) {
  const options = parseGitHooksArgs(argv);
  if (options.action === 'install') {
    const installReport = installGitHooks(options.cwd, { frameworkRequired: options.frameworkRequired });
    return makeResult({
      ok: installReport.ok,
      command: 'git-hooks',
      cwd: options.cwd,
      messages: [
        installReport.ok
          ? message('info', 'ATM_GIT_HOOKS_INSTALLED', 'ATM Git hooks are installed and configured.', installReport)
          : message('error', 'ATM_GIT_HOOKS_INSTALL_FAILED', 'ATM Git hooks could not be fully installed.', installReport)
      ],
      evidence: { action: 'install', report: installReport }
    });
  }
  const verifyReport = inspectGitHooks(options.cwd, { frameworkRequired: options.frameworkRequired });
  return makeResult({
    ok: verifyReport.ok,
    command: 'git-hooks',
    cwd: options.cwd,
    messages: [
      verifyReport.ok
        ? message('info', 'ATM_GIT_HOOKS_VERIFY_OK', 'ATM Git hook installation is healthy.', verifyReport)
        : message('error', 'ATM_GIT_HOOKS_VERIFY_FAILED', 'ATM Git hook installation is missing or drifted.', verifyReport)
    ],
    evidence: { action: 'verify', report: verifyReport }
  });
}

export function runCommitRangeGuard(argv: string[]) {
  const options = parseCommitRangeArgs(argv);
  const report = createCommitRangeGuardReport(options.cwd, options.base, options.head);
  return makeResult({
    ok: report.ok,
    command: 'guard',
    cwd: options.cwd,
    messages: [
      report.ok
        ? message('info', 'ATM_GUARD_COMMIT_RANGE_OK', 'Commit range guard passed.', {
          base: options.base,
          head: options.head,
          criticalCommitCount: report.criticalCommits.length
        })
        : message('error', 'ATM_GUARD_COMMIT_RANGE_FAILED', 'Commit range guard found high-risk closeout or task governance findings.', {
          base: options.base,
          head: options.head,
          findings: report.findings
        })
    ],
    evidence: { guard: 'commit-range', report }
  });
}
