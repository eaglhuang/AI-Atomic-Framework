import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readSync, fstatSync } from 'node:fs';
import path from 'node:path';
import { formatAtmResultLine } from './lib/atm-result-line.ts';

export function runLoggedBuild(command: string, args: readonly string[], logFile: string): number {
  let fd: number | undefined;
  let code = 1;
  let hint = 'cannot open build log; check path permissions';
  try {
    mkdirSync(path.dirname(logFile), { recursive: true });
    fd = openSync(logFile, 'a+');
    const start = fstatSync(fd).size;
    const result = spawnSync(command, args, {
      env: { ...process.env, ATM_BUILD_LOG_INNER: '1' },
      stdio: ['ignore', fd, fd]
    });
    code = result.status ?? 1;
    const size = fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size - start, 8192));
    readSync(fd, tail, 0, tail.length, size - tail.length);
    const messages = [...tail.toString().matchAll(/"message":\s*"([^"\n]+)"/g)];
    hint = code === 0 ? '' : `${messages.at(-1)?.[1] ?? result.error?.message ?? 'sealed build step failed'}; see log`;
  } catch (error) {
    code = 1;
    hint = `${(error as Error).message}; see log`;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  console.log(formatAtmResultLine({ step: 'sealed-build', status: code === 0 ? 'ok' : 'fail', code: code === 0 ? 'BUILD_OK' : 'BUILD_STEP_FAILED', log: logFile, hint }));
  return code;
}

export function withSealedBuildLog(): void {
  if (process.env.ATM_BUILD_LOG_INNER === '1') return;
  const index = process.argv.indexOf('--log-file');
  const logFile = index >= 0 ? process.argv[index + 1] : process.env.ATM_BUILD_LOG_FILE;
  if (!logFile) return;
  process.exit(runLoggedBuild(process.execPath, [...process.execArgv, ...process.argv.slice(1)], logFile));
}
