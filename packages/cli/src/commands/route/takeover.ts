import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyStewardPlan } from '../../../../core/src/broker/steward.ts';
import type { MergePlan, PatchProposal } from '../../../../core/src/broker/types.ts';
import { CliError, makeResult, message } from '../shared.ts';
import { restoreBackups } from './files.ts';
import type { RouteOptions } from './types.ts';

export function runTakeover(options: RouteOptions) {
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
  if (mergePlan.verdict === 'blocked-cid-conflict' || mergePlan.verdict === 'blocked-shared-surface') {
    throw new CliError('ATM_ROUTE_UNSAFE_TAKEOVER', `Steward takeover is blocked because the conflict verdict is unsafe: '${mergePlan.verdict}'.`, {
      exitCode: 1,
      details: { verdict: mergePlan.verdict }
    });
  }
  if (mergePlan.verdict === 'human-required') {
    return makeResult({
      ok: false,
      command: 'route',
      cwd: options.cwd,
      messages: [
        message('warn', 'ATM_ROUTE_HUMAN_REQUIRED', 'Steward takeover cannot proceed: merge plan verdict is human-required. Human intervention needed.', {
          verdict: mergePlan.verdict,
          stewardId: options.stewardId ?? 'neutral-write-steward',
          owningRouteId: options.routeId ?? null,
          owningTaskId: options.taskId ?? null
        })
      ],
      evidence: {
        action: 'takeover',
        verdict: 'human-required',
        stewardId: options.stewardId ?? 'neutral-write-steward',
        owningRouteId: options.routeId ?? null,
        owningTaskId: options.taskId ?? null
      }
    });
  }

  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8')) as PatchProposal;
  const proposals = [proposal];
  const stewardId = options.stewardId ?? 'neutral-write-steward';
  const scopeFiles = options.scopeFiles.length > 0 ? options.scopeFiles : proposals.map((entry) => entry.targetFile);
  const backups: Record<string, string | null> = {};

  for (const file of scopeFiles) {
    const fullPath = path.resolve(options.cwd, file);
    backups[file] = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : null;
  }

  const evidenceOutPath = options.evidenceOutPath ? path.resolve(options.cwd, options.evidenceOutPath) : null;
  const applyResult = applyStewardPlan({
    cwd: options.cwd,
    stewardId,
    mergePlan,
    proposals,
    scopeFiles,
    evidenceOutPath
  });

  if (!applyResult.ok) {
    restoreBackups(options.cwd, backups);
    return makeResult({
      ok: false,
      command: 'route',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_ROUTE_TAKEOVER_FAILED', 'Steward takeover merge failed.', {
          blockedReasons: applyResult.evidence.blockedReasons,
          stewardId,
          owningRouteId: options.routeId ?? null,
          owningTaskId: options.taskId ?? null
        })
      ],
      evidence: {
        action: 'takeover',
        applyResult,
        stewardId,
        owningRouteId: options.routeId ?? null,
        owningTaskId: options.taskId ?? null
      }
    });
  }

  const validators = proposal.validators && proposal.validators.length > 0 ? proposal.validators : ['npm run typecheck'];
  const validatorResults = [];
  let allPassed = true;

  for (const validator of validators) {
    const parts = validator.split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    const result = spawnSync(command, args, { cwd: options.cwd, shell: true, encoding: 'utf8' });
    const passed = result.status === 0;
    validatorResults.push({
      validator,
      passed,
      stdout: result.stdout,
      stderr: result.stderr
    });
    if (!passed) {
      allPassed = false;
      break;
    }
  }

  if (!allPassed) {
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

  return makeResult({
    ok: true,
    command: 'route',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_ROUTE_TAKEOVER_SUCCESS', 'Steward takeover successfully applied and verified via validator gates.', {
        stewardId,
        owningRouteId: options.routeId ?? null,
        owningTaskId: options.taskId ?? null
      })
    ],
    evidence: {
      action: 'takeover',
      applyResult,
      validatorResults,
      rolledBack: false,
      stewardId,
      owningRouteId: options.routeId ?? null,
      owningTaskId: options.taskId ?? null
    }
  });
}
