/**
 * Spawn a CLI whose stdout/stderr is later JSON.parsed.
 *
 * Node's spawnSync default maxBuffer is 1 MiB. Past that, the child is killed,
 * stdout is a partial string, and error.code is ERR_CHILD_PROCESS_STDIO_MAXBUFFER
 * (older Node: ENOBUFS). Parsing that partial string throws a JSON SyntaxError
 * or, when the caller substitutes `{}` and continues, a TypeError on a missing
 * field. Callers must see the truncation itself.
 */
import { spawnSync } from 'node:child_process';

export const CLI_JSON_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

const TRUNCATION_CODES = new Set(['ENOBUFS', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);

export function cliOutputTruncationCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = String((error as { code?: unknown }).code ?? '');
  return TRUNCATION_CODES.has(code) ? code : null;
}

export class CliOutputTruncatedError extends Error {
  readonly code: string;
  readonly maxBuffer: number;

  constructor(code: string, label: string, maxBuffer: number) {
    super(`CLI output truncated (${code}) for ${label}; maxBuffer is ${maxBuffer} bytes. Refusing to JSON.parse a partial payload.`);
    this.name = 'CliOutputTruncatedError';
    this.code = code;
    this.maxBuffer = maxBuffer;
  }
}

export interface CliCapture {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: NodeJS.ErrnoException | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SpawnCliCaptureOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeout?: number;
  input?: string;
  label?: string;
  windowsHide?: boolean;
  shell?: boolean | string;
}

export function spawnCliCapture(
  command: string,
  args: readonly string[],
  options: SpawnCliCaptureOptions = {}
): CliCapture {
  const maxBuffer = options.maxBuffer ?? CLI_JSON_MAX_BUFFER_BYTES;
  const label = options.label ?? [command, ...args].join(' ');
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer,
    timeout: options.timeout,
    input: options.input,
    windowsHide: options.windowsHide,
    shell: options.shell
  });
  const code = cliOutputTruncationCode(result.error);
  if (code) throw new CliOutputTruncatedError(code, label, maxBuffer);
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? '')
  };
}
