#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const createAtmPackage = {
  packageName: 'create-atm',
  packageRole: 'npm-create-governance-onboarding',
  packageVersion: '0.0.0'
} as const;

interface CreateAtmOptions {
  readonly projectName: string;
  readonly cwd: string;
  readonly agent?: string;
  readonly json: boolean;
}

interface StepResult {
  readonly name: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export function runCreateAtm(argv = process.argv.slice(2)) {
  const startedAt = Date.now();
  const options = parseArgs(argv);
  const targetRoot = path.resolve(options.cwd, options.projectName);
  ensureCreatableTarget(targetRoot);
  mkdirSync(targetRoot, { recursive: true });

  const atmEntrypoint = resolveAtmEntrypoint();
  const steps: StepResult[] = [];
  steps.push(runAtmStep('bootstrap', atmEntrypoint, ['bootstrap', '--cwd', targetRoot, '--json']));
  steps.push(runAtmStep('atm-chart render', atmEntrypoint, ['atm-chart', 'render', '--cwd', targetRoot, '--json']));
  if (options.agent) {
    steps.push(runAtmStep(`agent-pack install ${options.agent}`, atmEntrypoint, ['agent-pack', 'install', '--id', options.agent, '--cwd', targetRoot, '--json']));
  }

  const failedStep = steps.find((step) => step.exitCode !== 0);
  const payload = {
    ok: failedStep === undefined,
    command: 'create-atm',
    cwd: options.cwd,
    messages: [
      failedStep
        ? { level: 'error', code: 'ATM_CREATE_FAILED', text: `create-atm failed at step: ${failedStep.name}` }
        : { level: 'info', code: 'ATM_CREATE_READY', text: `ATM governance project created at ${targetRoot}` }
    ],
    evidence: {
      projectRoot: targetRoot,
      agent: options.agent ?? null,
      atmEntrypoint,
      durationMs: Date.now() - startedAt,
      steps: steps.map((step) => ({
        name: step.name,
        exitCode: step.exitCode,
        durationMs: step.durationMs
      }))
    }
  };

  writePayload(payload, options.json);
  return failedStep ? failedStep.exitCode : 0;
}

function parseArgs(argv: readonly string[]): CreateAtmOptions {
  const args = [...argv];
  const projectName = args.find((arg) => !arg.startsWith('-'));
  if (!projectName) {
    throwUsage('Usage: create-atm <project-name> [--agent <pack-id>] [--cwd <dir>] [--json]');
  }
  return {
    projectName,
    cwd: path.resolve(readOption(args, '--cwd') ?? process.cwd()),
    agent: readOption(args, '--agent'),
    json: args.includes('--json') || !process.stdout.isTTY
  };
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throwUsage(`${name} requires a value.`);
  }
  return value;
}

function throwUsage(message: string): never {
  process.stderr.write(`[create-atm] ${message}\n`);
  process.exit(2);
}

function ensureCreatableTarget(targetRoot: string): void {
  if (!existsSync(targetRoot)) return;
  const entries = readdirSync(targetRoot);
  if (entries.length > 0) {
    process.stderr.write(`[create-atm] target directory is not empty: ${targetRoot}\n`);
    process.exit(2);
  }
}

function resolveAtmEntrypoint(): string {
  const require = createRequire(import.meta.url);
  try {
    const cliIndexPath = require.resolve('@ai-atomic-framework/cli');
    const packageRoot = path.resolve(path.dirname(cliIndexPath), '..');
    const packagedEntrypoint = path.join(packageRoot, 'dist', 'atm.mjs');
    if (existsSync(packagedEntrypoint)) return packagedEntrypoint;
  } catch {
    // Fall through to source-tree lookup.
  }

  const sourceTreeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const sourceEntrypoint = path.join(sourceTreeRoot, 'atm.mjs');
  if (existsSync(sourceEntrypoint)) return sourceEntrypoint;

  process.stderr.write('[create-atm] unable to locate ATM CLI entrypoint.\n');
  process.exit(1);
}

function runAtmStep(name: string, atmEntrypoint: string, args: readonly string[]): StepResult {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [atmEntrypoint, ...args], {
    encoding: 'utf8',
    windowsHide: true
  });
  return {
    name,
    exitCode: child.status ?? 1,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    durationMs: Date.now() - startedAt
  };
}

function writePayload(payload: any, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const message = payload.messages[0]?.text ?? 'create-atm complete.';
  process.stdout.write(`[create-atm] ${message}\n`);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  process.exitCode = runCreateAtm();
}