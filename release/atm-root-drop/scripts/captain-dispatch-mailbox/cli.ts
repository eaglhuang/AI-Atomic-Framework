import path from 'node:path';
import type { AgentRef, MailboxOptions, Role } from './types.ts';
import {
  DEFAULT_AGENTS,
  DEFAULT_CAPTAIN_MODEL,
  DEFAULT_CAPTAIN_NO_DISPATCH_MINUTES,
  DEFAULT_CAPTAIN_NO_REPORT_LIMIT,
  DEFAULT_ROOT,
  DEFAULT_WORKER_MODEL,
  DEFAULT_WORKER_NO_DISPATCH_LIMIT,
  DEFAULT_WORKER_NO_REPORT_MINUTES
} from './constants.ts';

export function parseArgs(argv: string[]): MailboxOptions {
  const options: MailboxOptions = {
    root: DEFAULT_ROOT,
    agents: DEFAULT_AGENTS.map((id) => ({ id, model: DEFAULT_WORKER_MODEL })),
    captainModel: DEFAULT_CAPTAIN_MODEL,
    workerModel: DEFAULT_WORKER_MODEL,
    role: 'all' as Role,
    agentId: null,
    completeActive: false,
    reportStatus: 'done',
    reportSummary: null,
    reportEvidence: [],
    reportFile: null,
    staleMinutes: 5,
    maxDispatch: 10,
    captainNoReportLimit: DEFAULT_CAPTAIN_NO_REPORT_LIMIT,
    captainNoDispatchMinutes: DEFAULT_CAPTAIN_NO_DISPATCH_MINUTES,
    workerNoDispatchLimit: DEFAULT_WORKER_NO_DISPATCH_LIMIT,
    workerNoReportMinutes: DEFAULT_WORKER_NO_REPORT_MINUTES,
    clearStopLoss: false,
    reset: false,
    seedDemo: false,
    simulateWorkers: false,
    assertClean: false,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = requireValue(argv, index += 1, '--root');
    } else if (arg === '--agents') {
      options.agents = parseAgents(requireValue(argv, index += 1, '--agents'), options.workerModel);
    } else if (arg === '--captain-model') {
      options.captainModel = requireValue(argv, index += 1, '--captain-model');
    } else if (arg === '--worker-model') {
      options.workerModel = requireValue(argv, index += 1, '--worker-model');
      options.agents = options.agents.map((agent) => ({ ...agent, model: options.workerModel }));
    } else if (arg === '--role') {
      options.role = requireValue(argv, index += 1, '--role') as Role;
    } else if (arg === '--agent-id') {
      options.agentId = requireValue(argv, index += 1, '--agent-id');
    } else if (arg === '--complete-active') {
      options.completeActive = true;
    } else if (arg === '--report-status') {
      options.reportStatus = requireValue(argv, index += 1, '--report-status');
    } else if (arg === '--report-summary') {
      options.reportSummary = requireValue(argv, index += 1, '--report-summary');
    } else if (arg === '--report-evidence') {
      options.reportEvidence.push(requireValue(argv, index += 1, '--report-evidence'));
    } else if (arg === '--report-file') {
      options.reportFile = requireValue(argv, index += 1, '--report-file');
    } else if (arg === '--stale-minutes') {
      options.staleMinutes = Number(requireValue(argv, index += 1, '--stale-minutes'));
    } else if (arg === '--max-dispatch') {
      options.maxDispatch = Number(requireValue(argv, index += 1, '--max-dispatch'));
    } else if (arg === '--captain-no-report-limit') {
      options.captainNoReportLimit = Number(requireValue(argv, index += 1, '--captain-no-report-limit'));
    } else if (arg === '--captain-no-dispatch-minutes') {
      options.captainNoDispatchMinutes = Number(requireValue(argv, index += 1, '--captain-no-dispatch-minutes'));
    } else if (arg === '--worker-no-dispatch-limit') {
      options.workerNoDispatchLimit = Number(requireValue(argv, index += 1, '--worker-no-dispatch-limit'));
    } else if (arg === '--worker-no-report-minutes') {
      options.workerNoReportMinutes = Number(requireValue(argv, index += 1, '--worker-no-report-minutes'));
    } else if (arg === '--clear-stop-loss') {
      options.clearStopLoss = true;
    } else if (arg === '--reset') {
      options.reset = true;
    } else if (arg === '--seed-demo') {
      options.seedDemo = true;
    } else if (arg === '--simulate-workers') {
      options.simulateWorkers = true;
    } else if (arg === '--assert-clean') {
      options.assertClean = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.staleMinutes) || options.staleMinutes < 0) {
    throw new Error('--stale-minutes must be a non-negative number');
  }
  if (!Number.isInteger(options.maxDispatch) || options.maxDispatch < 1) {
    throw new Error('--max-dispatch must be a positive integer');
  }
  if (!Number.isInteger(options.captainNoReportLimit) || options.captainNoReportLimit < 1) {
    throw new Error('--captain-no-report-limit must be a positive integer');
  }
  if (!Number.isFinite(options.captainNoDispatchMinutes) || options.captainNoDispatchMinutes < 0) {
    throw new Error('--captain-no-dispatch-minutes must be a non-negative number');
  }
  if (!Number.isInteger(options.workerNoDispatchLimit) || options.workerNoDispatchLimit < 1) {
    throw new Error('--worker-no-dispatch-limit must be a positive integer');
  }
  if (!Number.isFinite(options.workerNoReportMinutes) || options.workerNoReportMinutes < 0) {
    throw new Error('--worker-no-report-minutes must be a non-negative number');
  }
  if (options.agents.length === 0) {
    throw new Error('At least one agent is required');
  }
  if (!['captain', 'worker', 'all'].includes(options.role)) {
    throw new Error('--role must be one of: captain, worker, all');
  }
  if (options.agentId) {
    assertSafeId(options.agentId, 'agent id');
  }
  if (options.role === 'worker' && !options.agentId) {
    throw new Error('--role worker requires --agent-id');
  }

  return options;
}

export function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseAgents(value: string, defaultModel: string): AgentRef[] {
  return value.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, model = defaultModel] = entry.split(':').map((part) => part.trim());
      assertSafeId(id, 'agent id');
      return { id, model };
    });
}

export function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value || '')) {
    throw new Error(`${label} must use only letters, numbers, "_" or "-": ${value}`);
  }
}

export function printHelp() {
  console.log([
    'Usage: node scripts/captain-dispatch-mailbox.mjs [options]',
    '',
    'Runs one captain/agent mailbox polling cycle.',
    '',
    'Options:',
    `  --root <path>             Mailbox root. Default: ${DEFAULT_ROOT}`,
    '  --agents <list>           Comma list, optionally id:model. Default: 001,002,003',
    `  --captain-model <model>   Captain model metadata. Default: ${DEFAULT_CAPTAIN_MODEL}`,
    `  --worker-model <model>    Worker model metadata. Default: ${DEFAULT_WORKER_MODEL}`,
    '  --role <role>             captain, worker, or all. Default: all',
    '  --agent-id <id>           Worker id for --role worker',
    '  --complete-active         Worker mode: complete the active dispatch and send a report',
    '  --report-status <status>  Worker report status. Default: done',
    '  --report-summary <text>   Worker report body summary',
    '  --report-evidence <text>  Repeatable command-backed evidence line for done reports',
    '  --report-file <path>      Worker Markdown report file following the dispatch Report Contract',
    '  --stale-minutes <n>       Flag unclaimed inbox files older than n minutes. Default: 5',
    '  --max-dispatch <n>        Max queued jobs dispatched in one cycle. Default: 10',
    `  --captain-no-report-limit <n>     Stop captain automation after n cycles with no reports. Default: ${DEFAULT_CAPTAIN_NO_REPORT_LIMIT}`,
    `  --captain-no-dispatch-minutes <n> Stop captain automation after queued work waits n minutes with no dispatch. Default: ${DEFAULT_CAPTAIN_NO_DISPATCH_MINUTES}`,
    `  --worker-no-dispatch-limit <n>    Stop worker automation after n idle cycles with no dispatch. Default: ${DEFAULT_WORKER_NO_DISPATCH_LIMIT}`,
    `  --worker-no-report-minutes <n>    Stop worker automation after active work waits n minutes with no report. Default: ${DEFAULT_WORKER_NO_REPORT_MINUTES}`,
    '  --clear-stop-loss       Clear the current captain/worker stop-loss state and skip polling',
    '  --seed-demo               Add demo work items when the queue is empty',
    '  --simulate-workers        Make workers finish claimed demo work immediately',
    '  --assert-clean            Exit non-zero unless the cycle leaves no backlog',
    '  --reset                   Remove the mailbox root before running',
    '  --json                    Emit a machine-readable summary',
    '',
    'Queue files go in captain/work-queue as JSON or Markdown with simple front matter.',
    'Dispatch files are Markdown and are delivered to agents/<agent-id>/inbox.',
    'Reports are Markdown files delivered to captain/inbox and archived to captain/reports.'
  ].join('\n'));
}
