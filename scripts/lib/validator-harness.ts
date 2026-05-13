import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  readonly runAtmJson: (args: string[], cwd?: string) => { exitCode: number; parsed: any };
  readonly ok: (summary: string) => void;
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

  function runAtmJson(args: string[], cwd = root): { exitCode: number; parsed: any } {
    const result = spawnSync(process.execPath, [repoPath('atm.mjs'), ...args], {
      cwd,
      encoding: 'utf8'
    });
    const payload = (result.stdout || result.stderr || '').trim();
    if (!payload) {
      return { exitCode: result.status ?? 0, parsed: {} };
    }
    try {
      return {
        exitCode: result.status ?? 0,
        parsed: JSON.parse(payload)
      };
    } catch (error) {
      fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || (error instanceof Error ? error.message : String(error))}`);
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
    runAtmJson,
    ok
  };
}
