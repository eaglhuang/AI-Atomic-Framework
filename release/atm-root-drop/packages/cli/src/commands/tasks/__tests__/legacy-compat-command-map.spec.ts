import { runTasksCompatCommandMap, type LegacyTasksCompatCommandHandlers } from '../legacy/compat-command-map.ts';
import { createRepairReconcileLane } from '../legacy/repair-reconcile-lane.ts';
import { createTransitionCompatLane } from '../legacy/transition-compat.ts';
import { makeResult, type CommandResult } from '../../shared.ts';

function fail(message: string): never {
  console.error(`[legacy-compat-command-map.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

const calls: string[] = [];

function handler(name: string) {
  return (argv: string[]): CommandResult => {
    calls.push(`${name}:${argv.join(' ')}`);
    return makeResult({ ok: true, command: name, cwd: process.cwd(), evidence: { argv } });
  };
}

const repairLane = createRepairReconcileLane({
  reconcile: handler('reconcile-lane'),
  repairClosure: handler('repair-closure-lane'),
  repairClaim: handler('repair-claim-lane')
});

const transitionLane = createTransitionCompatLane({
  claimLifecycle: (action, argv) => handler(`claim-${action}`)(argv),
  deliverAndClose: handler('deliver-and-close-lane')
});

const handlers: LegacyTasksCompatCommandHandlers = {
  close: handler('close'),
  reset: handler('reset'),
  create: handler('create'),
  mirror: handler('mirror'),
  audit: handler('audit'),
  queue: handler('queue'),
  parallel: handler('parallel'),
  lock: handler('lock'),
  migrateLegacyLedger: handler('migrate-legacy-ledger'),
  claimLifecycle: transitionLane.claimLifecycle,
  reconcile: repairLane.reconcile,
  repairClosure: repairLane.repairClosure,
  repairClaim: repairLane.repairClaim,
  show: handler('show'),
  status: handler('status'),
  finalize: handler('finalize'),
  deliverAndClose: transitionLane.deliverAndClose,
  roster: handler('roster'),
  newTask: handler('new'),
  importTask: handler('import'),
  verify: handler('verify'),
  scope: handler('scope'),
  realignPlanSource: handler('realign-plan-source')
};

await runTasksCompatCommandMap(['reconcile', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'reconcile-lane:--task TASK-1', 'reconcile must route through the repair/reconcile lane');

await runTasksCompatCommandMap(['repair-claim', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'repair-claim-lane:--task TASK-1', 'repair-claim must route through the repair/reconcile lane');

await runTasksCompatCommandMap(['claim', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'claim-claim:--task TASK-1', 'claim must route through transition compat lane');

await runTasksCompatCommandMap(['deliver-and-close', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'deliver-and-close-lane:--task TASK-1', 'deliver-and-close must route through transition compat lane');

console.log('[legacy-compat-command-map.spec] ok');
