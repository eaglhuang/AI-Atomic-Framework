/**
 * Shared scaffolding for `scripts/validate-*.ts` and `tests/**` validators.
 *
 * Use `createValidator(name)` to get a consistent surface:
 *   - `assert / fail / ok` — uniform error and success reporting
 *   - `readText / readJson / requireFile` — repo-rooted file IO
 *   - `createAjv()` — AJV 2020 instance with `addFormats` pre-registered
 *   - `runAtmJson(args)` — spawn `node atm.mjs <args>` and parse JSON output
 *
 * Migration target: the ~60 `scripts/validate-*.ts` files that still build
 * their own scaffolding should adopt this harness incrementally. Look for
 * duplicated patterns (manual AJV setup, manual spawnSync wrappers, manual
 * file-existence checks) and replace with the harness helpers below.
 *
 * See `docs/testing-strategy.md` for the four-layer test taxonomy this
 * harness belongs to (the "validator" layer).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export type ValidatorMode = 'test' | 'validate' | 'lint' | 'typecheck' | string;

export interface ValidatorHarness {
  readonly name: string;
  readonly mode: ValidatorMode;
  readonly root: string;
  readonly repoPath: (...segments: string[]) => string;
  readonly assert: (condition: unknown, message: string) => void;
  readonly fail: (message: string) => never;
  readonly readText: (relativePath: string) => string;
  readonly readJson: <T = unknown>(relativePath: string) => T;
  readonly requireFile: (relativePath: string, message?: string) => string;
  readonly createAjv: () => Ajv2020;
  /**
   * Load a JSON schema from a repo-relative path and return a compiled AJV
   * validator. Combines `readJson + createAjv + ajv.compile` — the common
   * three-line pattern repeated across most schema validators.
   */
  readonly loadSchemaValidator: <T = unknown>(relativeSchemaPath: string) => (value: unknown) => value is T;
  readonly runAtmJson: (args: string[], cwd?: string) => { exitCode: number; parsed: any; launcher: 'atm.mjs' | 'source-cli' };
  readonly runAtmJsonPortable: (args: string[], cwd?: string) => Promise<{ exitCode: number; parsed: any; launcher: 'atm.mjs' | 'source-cli' }>;
  readonly ok: (summary: string) => void;
}

interface AtmJsonExecutionResult {
  readonly exitCode: number;
  readonly parsed: any;
  readonly launcher: 'atm.mjs' | 'source-cli';
}

function resolveRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function parseValidatorMode(argv: string[] = process.argv.slice(2), fallback: ValidatorMode = 'validate'): ValidatorMode {
  const index = argv.indexOf('--mode');
  if (index === -1) return fallback;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

export function createValidator(name: string, options: { argv?: string[]; defaultMode?: ValidatorMode } = {}): ValidatorHarness {
  const root = resolveRoot();
  const mode = parseValidatorMode(options.argv ?? process.argv.slice(2), options.defaultMode ?? 'validate');

  function fail(message: string): never {
    throw new Error(`[${name}:${mode}] ${message}`);
  }

  function assert(condition: unknown, message: string): void {
    if (!condition) fail(message);
  }

  function repoPath(...segments: string[]): string {
    return path.join(root, ...segments);
  }

  function readText(relativePath: string): string {
    const filePath = repoPath(relativePath);
    assert(existsSync(filePath), `missing file: ${relativePath}`);
    return readFileSync(filePath, 'utf8');
  }

  function readJson<T = unknown>(relativePath: string): T {
    return JSON.parse(readText(relativePath)) as T;
  }

  function requireFile(relativePath: string, message = `missing file: ${relativePath}`): string {
    const filePath = repoPath(relativePath);
    assert(existsSync(filePath), message);
    return filePath;
  }

  function createAjv(): Ajv2020 {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv;
  }

  function loadSchemaValidator<T = unknown>(relativeSchemaPath: string): (value: unknown) => value is T {
    const schema = readJson(relativeSchemaPath);
    const ajv = createAjv();
    const compiled = ajv.compile(schema as object);
    return (value: unknown): value is T => compiled(value) as boolean;
  }

  function runAtmJson(args: string[], cwd = root): AtmJsonExecutionResult {
    const primary = runAtmJsonAttempt(args, cwd, 'atm.mjs');
    if (shouldFallbackToSourceCli(primary.exitCode, primary.payload)) {
      return finalizeAtmJsonResult(runAtmJsonAttempt(args, cwd, 'source-cli'), args);
    }
    return finalizeAtmJsonResult(primary, args);
  }

  async function runAtmJsonPortable(args: string[], cwd = root): Promise<AtmJsonExecutionResult> {
    const primary = runAtmJsonAttempt(args, cwd, 'atm.mjs');
    if (!shouldFallbackToSourceCli(primary.exitCode, primary.payload)) {
      return finalizeAtmJsonResult(primary, args);
    }
    return await runAtmJsonInProcess(args, cwd);
  }

  function runAtmJsonAttempt(
    args: string[],
    cwd: string,
    launcher: 'atm.mjs' | 'source-cli'
  ): { exitCode: number; payload: string; launcher: 'atm.mjs' | 'source-cli' } {
    const commandArgs = launcher === 'atm.mjs'
      ? [repoPath('atm.mjs'), ...args]
      : ['--strip-types', repoPath('packages', 'cli', 'src', 'atm.ts'), ...args];
    const result = spawnSync(process.execPath, commandArgs, {
      cwd,
      encoding: 'utf8'
    });
    const errorPayload = result.error
      ? `${result.error.name}: ${result.error.message}${'code' in result.error && result.error.code ? ` (${String(result.error.code)})` : ''}`
      : '';
    return {
      exitCode: result.status ?? (result.error ? 1 : 0),
      payload: (result.stdout || result.stderr || errorPayload || '').trim(),
      launcher
    };
  }

  function finalizeAtmJsonResult(
    result: { exitCode: number; payload: string; launcher: 'atm.mjs' | 'source-cli' },
    args: string[]
  ): AtmJsonExecutionResult {
    const payload = result.payload;
    if (!payload) {
      return { exitCode: result.exitCode, parsed: {}, launcher: result.launcher };
    }
    try {
      return {
        exitCode: result.exitCode,
        parsed: JSON.parse(payload),
        launcher: result.launcher
      };
    } catch (error) {
      fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || (error instanceof Error ? error.message : String(error))}`);
    }
  }

  function shouldFallbackToSourceCli(exitCode: number, payload: string): boolean {
    if (exitCode === 0) return false;
    return /spawnSync .*node(?:\.exe)? (?:EPERM|EACCES)/i.test(payload)
      || /Error:\s+spawnSync .*node(?:\.exe)? (?:EPERM|EACCES)/i.test(payload);
  }

  async function runAtmJsonInProcess(args: string[], cwd: string): Promise<AtmJsonExecutionResult> {
    const { runCli } = await import(pathToFileURL(repoPath('packages', 'cli', 'src', 'atm.ts')).href);
    let stdout = '';
    let stderr = '';
    const io = {
      stdout: {
        isTTY: false,
        write(chunk: string) {
          stdout += String(chunk);
        }
      },
      stderr: {
        isTTY: false,
        write(chunk: string) {
          stderr += String(chunk);
        }
      }
    };
    const previousCwd = process.cwd();
    try {
      process.chdir(cwd);
      const exitCode = await runCli(args, io);
      return finalizeAtmJsonResult({
        exitCode,
        payload: (stdout || stderr).trim(),
        launcher: 'source-cli'
      }, args);
    } finally {
      process.chdir(previousCwd);
    }
  }

  function ok(summary: string): void {
    process.stdout.write(`[${name}:${mode}] ok (${summary})\n`);
  }

  return {
    name,
    mode,
    root,
    repoPath,
    assert,
    fail,
    readText,
    readJson,
    requireFile,
    createAjv,
    loadSchemaValidator,
    runAtmJson,
    runAtmJsonPortable,
    ok
  };
}
