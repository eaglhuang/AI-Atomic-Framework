import { runDoctor } from './doctor.mjs';
import { makeResult, message, parseOptions } from './shared.mjs';

export function runNext(argv) {
  const { options } = parseOptions(argv, 'next');
  const doctor = runDoctor(['--cwd', options.cwd]);
  const failed = doctor.evidence.checks.find((check) => check.ok !== true);
  const nextAction = failed ? { status: 'blocked', command: 'node packages/cli/src/atm.mjs doctor --json', reason: failed.name } : { status: 'ready', command: 'npm test', reason: 'all doctor checks passed' };
  return makeResult({
    ok: failed ? false : true,
    command: 'next',
    cwd: options.cwd,
    messages: [failed ? message('error', 'ATM_NEXT_BLOCKED', 'Run doctor and resolve the first failing check before continuing.', nextAction) : message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction)],
    evidence: { nextAction, doctorSummary: doctor.evidence.checks.map((check) => ({ name: check.name, ok: check.ok })) }
  });
}
