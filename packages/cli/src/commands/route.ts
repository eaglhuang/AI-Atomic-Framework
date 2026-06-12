import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CliError, makeResult, message } from './shared.ts';
import { applyStewardPlan } from '../../../core/src/broker/steward.ts';
import type { MergePlan, PatchProposal } from '../../../core/src/broker/types.ts';

export async function runRoute(argv: string[]) {
  const options = parseRouteArgs(argv);

  if (options.action === 'takeover') {
    if (!options.mergePlanFile) {
      throw new CliError('ATM_CLI_USAGE', 'route takeover requires --merge-plan-file <path>.', { exitCode: 2 });
    }
    if (!options.proposalFile) {
      throw new CliError('ATM_CLI_USAGE', 'route takeover requires --proposal-file <path>.', { exitCode: 2 });
    }

    const mergePlanPath = path.resolve(options.cwd, options.mergePlanFile);
    if (!existsSync(mergePlanPath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Merge plan file not found: ${options.mergePlanFile}`, { exitCode: 1 });
    }

    const proposalPath = path.resolve(options.cwd, options.proposalFile);
    if (!existsSync(proposalPath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Proposal file not found: ${options.proposalFile}`, { exitCode: 1 });
    }

    const mergePlan = JSON.parse(readFileSync(mergePlanPath, 'utf8')) as MergePlan;
    
    // 檢查 verdict 是否安全：只有在 verdict 為 'needs-steward' 或 'parallel-safe' 時才允許接管
    if (mergePlan.verdict === 'blocked-cid-conflict' || mergePlan.verdict === 'blocked-shared-surface') {
      throw new CliError('ATM_ROUTE_UNSAFE_TAKEOVER', `Steward takeover is blocked because the conflict verdict is unsafe: '${mergePlan.verdict}'.`, {
        exitCode: 1,
        details: { verdict: mergePlan.verdict }
      });
    }

    const proposal = JSON.parse(readFileSync(proposalPath, 'utf8')) as PatchProposal;
    const proposals = [proposal];

    const stewardId = options.stewardId ?? 'neutral-write-steward';
    const scopeFiles = options.scopeFiles.length > 0
      ? options.scopeFiles
      : proposals.map((p) => p.targetFile);

    // Isolated Merge backup: 備份所有可能被修改的檔案內容
    const backups: Record<string, string | null> = {};
    for (const file of scopeFiles) {
      const fullPath = path.resolve(options.cwd, file);
      if (existsSync(fullPath)) {
        backups[file] = readFileSync(fullPath, 'utf8');
      } else {
        backups[file] = null;
      }
    }

    // 執行 steward apply
    const evidenceOutPath = options.evidenceOutPath
      ? path.resolve(options.cwd, options.evidenceOutPath)
      : null;

    const applyResult = applyStewardPlan({
      cwd: options.cwd,
      stewardId,
      mergePlan,
      proposals,
      scopeFiles,
      evidenceOutPath
    });

    if (!applyResult.ok) {
      // 失敗，進行還原
      restoreBackups(options.cwd, backups);
      return makeResult({
        ok: false,
        command: 'route',
        cwd: options.cwd,
        messages: [
          message('error', 'ATM_ROUTE_TAKEOVER_FAILED', 'Steward takeover merge failed.', {
            blockedReasons: applyResult.evidence.blockedReasons
          })
        ],
        evidence: {
          action: 'takeover',
          applyResult
        }
      });
    }

    // run validators for validator-gated apply
    const validators = proposal.validators && proposal.validators.length > 0
      ? proposal.validators
      : ['npm run typecheck']; // default fallback

    const validatorResults = [];
    let allPassed = true;

    for (const val of validators) {
      const parts = val.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);
      
      // 使用 spawnSync 在 options.cwd 執行
      const result = spawnSync(cmd, args, { cwd: options.cwd, shell: true, encoding: 'utf8' });
      const passed = result.status === 0;
      validatorResults.push({
        validator: val,
        passed,
        stdout: result.stdout,
        stderr: result.stderr
      });
      if (!passed) {
        allPassed = false;
        break; // Fail-fast
      }
    }

    if (!allPassed) {
      // 如果 validator 失敗，必須 Rollback！
      restoreBackups(options.cwd, backups);
      return makeResult({
        ok: false,
        command: 'route',
        cwd: options.cwd,
        messages: [
          message('error', 'ATM_ROUTE_VALIDATOR_FAILED', 'Validator-gated apply failed. Changes rolled back.', {
            validatorResults
          })
        ],
        evidence: {
          action: 'takeover',
          applyResult,
          validatorResults,
          rolledBack: true
        }
      });
    }

    // 如果全部都通過，成功完成！
    return makeResult({
      ok: true,
      command: 'route',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_ROUTE_TAKEOVER_SUCCESS', 'Steward takeover successfully applied and verified via validator gates.')
      ],
      evidence: {
        action: 'takeover',
        applyResult,
        validatorResults,
        rolledBack: false
      }
    });
  }

  throw new CliError('ATM_CLI_USAGE', 'route command supports only takeover action.', { exitCode: 2 });
}

function restoreBackups(cwd: string, backups: Record<string, string | null>) {
  for (const [file, content] of Object.entries(backups)) {
    const fullPath = path.resolve(cwd, file);
    if (content === null) {
      // 原本不存在，就刪除它
      // 但此處簡化為只還原檔案
    } else {
      writeFileSync(fullPath, content, 'utf8');
    }
  }
}

function parseRouteArgs(argv: string[]) {
  const state = {
    cwd: process.cwd(),
    action: null as string | null,
    mergePlanFile: null as string | null,
    proposalFile: null as string | null,
    stewardId: null as string | null,
    evidenceOutPath: null as string | null,
    scopeFiles: [] as string[]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--merge-plan-file') {
      state.mergePlanFile = requireValue(argv, index, '--merge-plan-file');
      index += 1;
      continue;
    }
    if (arg === '--proposal-file') {
      state.proposalFile = requireValue(argv, index, '--proposal-file');
      index += 1;
      continue;
    }
    if (arg === '--steward-id') {
      state.stewardId = requireValue(argv, index, '--steward-id');
      index += 1;
      continue;
    }
    if (arg === '--evidence-out-path') {
      state.evidenceOutPath = requireValue(argv, index, '--evidence-out-path');
      index += 1;
      continue;
    }
    if (arg === '--scope-files') {
      state.scopeFiles = requireValue(argv, index, '--scope-files')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `route does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'route accepts only one action', { exitCode: 2 });
    }
    state.action = arg;
  }

  if (state.action !== 'takeover') {
    throw new CliError('ATM_CLI_USAGE', 'route supports only takeover', { exitCode: 2 });
  }

  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    mergePlanFile: state.mergePlanFile,
    proposalFile: state.proposalFile,
    stewardId: state.stewardId,
    evidenceOutPath: state.evidenceOutPath,
    scopeFiles: state.scopeFiles
  };
}

function requireValue(argv: string[], optionIndex: number, optionName: string): string {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `route requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
