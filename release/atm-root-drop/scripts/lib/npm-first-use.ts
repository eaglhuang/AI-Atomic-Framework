import { spawnSync } from 'node:child_process';

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
  const initial = runBin(['next', '--prompt', 'Verify first-use npm install workflow', '--json']);
  steps.push({ command: 'atm next --prompt <validation prompt> --json', exitCode: initial.status });
  if (initial.error || (initial.status !== 0 && initial.status !== 1)) {
    return { exitCode: initial.status ?? 1, passed: false, reachedReady: false, steps, failure: `initial next failed to run: ${String(initial.error ?? initial.stderr ?? '')}` };
  }

  let current = parseCommandJson(initial);
  if (!current) {
    return { exitCode: initial.status ?? 1, passed: false, reachedReady: false, steps, failure: 'initial next did not return parseable JSON' };
  }
  const tokenize = (command: string) => [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  let ready = initial.status === 0 && ['ready', 'no-work'].includes(current.evidence?.nextAction?.status ?? '');
  for (let attempt = 0; !ready && attempt < 8; attempt += 1) {
    const command = current.evidence?.nextAction?.command;
    if (typeof command !== 'string') {
      return { exitCode: 1, passed: false, reachedReady: false, steps, failure: `next did not provide an executable first-use action: ${JSON.stringify(current.evidence?.nextAction ?? null)}` };
    }
    const tokens = tokenize(command);
    if (tokens[0] !== 'npm' || tokens[1] !== 'exec' || tokens[2] !== '--' || tokens[3] !== 'atm') {
      return { exitCode: 1, passed: false, reachedReady: false, steps, failure: `generated command is not runnable from a clean npm install: ${command}` };
    }
    const action = runBin(tokens.slice(4));
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

