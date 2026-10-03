import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { governanceCommandPrefix } from '../../packages/cli/src/commands/shared/atm-cli-entrypoint.ts';

/** Accept only the bounded onboarding actions for this installed package.
 * Never execute a binary or shell expression supplied by generated text. */
export function resolveFirstUseArguments(command: string, bin: string, guideGoal?: string): string[] | null {
  const packageRoot = path.resolve(path.dirname(bin), '../@ai-atomic-framework/cli');
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== '@ai-atomic-framework/cli' || typeof pkg.bin?.atm !== 'string') return null;
  const runtime = path.resolve(packageRoot, pkg.bin.atm);
  if (!runtime.startsWith(`${packageRoot}${path.sep}`)) return null;
  const entries = [runtime];
  if (process.platform !== 'win32' && realpathSync(bin) === realpathSync(runtime)) entries.push(path.resolve(bin));
  const prefixes = [...entries.map(entry => `${governanceCommandPrefix(entry)} `), 'npm exec -- atm '];
  const prefix = prefixes.find(value => command.startsWith(value));
  if (!prefix) return null;
  const suffix = command.slice(prefix.length);
  if (guideGoal !== undefined && suffix === `guide --goal ${JSON.stringify(guideGoal)} --cwd . --json`) {
    return ['guide', '--goal', guideGoal, '--cwd', '.', '--json'];
  }
  const actions: ReadonlyArray<readonly [string, string[]]> = [
    ['bootstrap --cwd . --task "Bootstrap ATM in this repository"', ['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM in this repository']],
    ['bootstrap --cwd . --force --task "Bootstrap ATM in this repository"', ['bootstrap', '--cwd', '.', '--force', '--task', 'Bootstrap ATM in this repository']],
    ['atm-chart render --cwd . --json', ['atm-chart', 'render', '--cwd', '.', '--json']],
    ['orient --cwd . --json', ['orient', '--cwd', '.', '--json']]
  ];
  const action = actions.find(([text]) => suffix === text);
  if (action) return action[1];
  const handoff = suffix.match(/^handoff summarize --task ([A-Za-z0-9_-]+) --json$/);
  return handoff ? ['handoff', 'summarize', '--task', handoff[1], '--json'] : null;
}

type FirstUseCommandResult = {
  evidence?: { nextAction?: { status?: string; command?: string | null } };
};

function parseCommandJson(result: ReturnType<typeof spawnSync>): FirstUseCommandResult | null {
  const stdout = String(result.stdout ?? '').trim();
  const stderr = String(result.stderr ?? '').trim();
  for (const output of [stdout, stderr, `${stdout}${stderr}`, `${stderr}${stdout}`]) {
    if (!output) continue;
    try {
      return JSON.parse(output) as FirstUseCommandResult;
    } catch {
      // CLI JSON may be emitted on either stream, including on non-zero status.
    }
  }
  return null;
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  return `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`.trim().slice(0, 600);
}

export function runFirstUseChain(bin: string, cwd: string): Record<string, unknown> {
  const steps: Array<{ command: string; exitCode: number | null }> = [];
  const runBin = (argv: string[]) => spawnSync(bin, argv, {
    cwd, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32'
  });
  const guideGoal = 'Verify first-use npm install workflow';
  const initial = runBin(['next', '--prompt', guideGoal, '--json']);
  steps.push({ command: 'atm next --prompt <validation prompt> --json', exitCode: initial.status });
  if (initial.error || (initial.status !== 0 && initial.status !== 1)) {
    return { exitCode: initial.status ?? 1, passed: false, reachedReady: false, steps, failure: `initial next failed to run: ${String(initial.error ?? initial.stderr ?? '')}` };
  }

  let current = parseCommandJson(initial);
  if (!current) {
    return { exitCode: initial.status ?? 1, passed: false, reachedReady: false, steps, failure: 'initial next did not return parseable JSON' };
  }
  let ready = initial.status === 0 && ['ready', 'no-work'].includes(current.evidence?.nextAction?.status ?? '');
  for (let attempt = 0; !ready && attempt < 8; attempt += 1) {
    const command = current.evidence?.nextAction?.command;
    if (typeof command !== 'string') {
      return { exitCode: 1, passed: false, reachedReady: false, steps, failure: `next did not provide an executable first-use action: ${JSON.stringify(current.evidence?.nextAction ?? null)}` };
    }
    const actionArguments = resolveFirstUseArguments(command, bin, guideGoal);
    if (!actionArguments) {
      return { exitCode: 1, passed: false, reachedReady: false, steps, failure: `generated command is not runnable from a clean npm install: ${command}` };
    }
    const action = runBin(actionArguments);
    steps.push({ command, exitCode: action.status });
    if (action.error || action.status !== 0) {
      return { exitCode: action.status ?? 1, passed: false, reachedReady: false, steps, failure: `generated first-use action failed: ${command}; ${String(action.error ?? action.stderr ?? action.stdout ?? '')}` };
    }
    const refreshed = runBin(['next', '--json']);
    steps.push({ command: 'atm next --json', exitCode: refreshed.status });
    if (refreshed.error || (refreshed.status !== 0 && refreshed.status !== 1)) {
      return { exitCode: refreshed.status ?? 1, passed: false, reachedReady: false, steps, failure: `next failed after generated action: ${String(refreshed.error ?? refreshed.stderr ?? '')}` };
    }
    current = parseCommandJson(refreshed);
    if (!current) {
      return { exitCode: refreshed.status ?? 1, passed: false, reachedReady: false, steps, failure: `next did not return parseable JSON after generated action: ${commandOutput(refreshed)}` };
    }
    ready = refreshed.status === 0 && ['ready', 'no-work'].includes(current.evidence?.nextAction?.status ?? '');
  }
  if (!ready) {
    return { exitCode: 1, passed: false, reachedReady: false, steps, failure: 'generated first-use actions did not reach ready/no-work within eight steps' };
  }
  return { exitCode: 0, passed: true, reachedReady: true, steps, failure: null };
}
