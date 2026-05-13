import { runDoctor } from './doctor.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { makeResult, message, parseOptions } from './shared.ts';

export function runNext(argv: any) {
  const { options } = parseOptions(argv, 'next');
  const doctor = runDoctor(['--cwd', options.cwd]);
  const runtime = detectGovernanceRuntime(options.cwd, bootstrapTaskId);
  const failed = doctor.evidence.checks.find((check: any) => check.ok !== true);
  const nextAction = decideNextAction(runtime, failed?.name ?? null);
  return makeResult({
    ok: nextAction.status === 'ready',
    command: 'next',
    cwd: options.cwd,
    messages: [nextAction.status === 'ready' ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction) : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)],
    evidence: {
      nextAction,
      doctorSummary: doctor.evidence.checks.map((check: any) => ({ name: check.name, ok: check.ok })),
      layoutVersion: runtime.layoutVersion,
      currentTaskId: runtime.currentTaskId,
      lockOwner: runtime.activeLock?.owner ?? null,
      lastEvidenceAt: runtime.lastEvidenceAt,
      lastHandoffAt: runtime.lastHandoffAt
    }
  });
}

function decideNextAction(runtime: any, failedCheckName: any) {
  if (runtime.migrationNeeded || runtime.hasV1 && runtime.hasV2 === false) {
    return {
      status: 'needs-bootstrap',
      command: 'node atm.mjs bootstrap --cwd . --force --task "Bootstrap ATM in this repository"',
      reason: 'legacy layout needs migration to runtime/history/catalog'
    };
  }
  if (!runtime.config) {
    return {
      status: 'needs-bootstrap',
      command: 'node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository"',
      reason: '.atm/config.json is missing'
    };
  }
  if (!runtime.currentTaskId) {
    return {
      status: 'needs-task',
      command: 'node atm.mjs guide create-atom',
      reason: 'no active governed work item is recorded'
    };
  }
  if (!runtime.lastEvidenceAt) {
    return {
      status: 'needs-evidence',
      command: `node atm.mjs handoff summarize --task ${runtime.currentTaskId} --json`,
      reason: 'the current governed task does not have recorded evidence yet'
    };
  }
  if (!runtime.lastHandoffAt) {
    return {
      status: 'needs-handoff',
      command: `node atm.mjs handoff summarize --task ${runtime.currentTaskId} --json`,
      reason: 'the current governed task does not have a handoff summary yet'
    };
  }
  if (failedCheckName) {
    return {
      status: 'needs-validation',
      command: 'npm run validate:full',
      reason: `doctor reported a failing check: ${failedCheckName}`
    };
  }
  return {
    status: 'ready',
    command: 'npm test',
    reason: 'runtime state, governance state, and engineering checks are all green'
  };
}
