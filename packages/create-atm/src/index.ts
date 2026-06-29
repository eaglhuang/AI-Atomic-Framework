#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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
  readonly tag: CreateAtmDistTag;
  readonly json: boolean;
}

type CreateAtmDistTag = 'latest' | 'next' | 'beta' | 'lts';

interface CreateAtmDistTagSelection {
  readonly schemaVersion: 'atm.distTagSelection.v0.1';
  readonly requestedTag: CreateAtmDistTag;
  readonly tier: 'stable' | 'beta' | 'experimental' | 'lts';
  readonly expectedCliPrerelease: 'beta' | 'alpha' | null;
  readonly npmPackageSpec: string;
  readonly source: 'create-atm';
}

interface AtmExecutionPlan {
  readonly command: string;
  readonly argsPrefix: readonly string[];
  readonly display: string;
  readonly source: 'source-tree' | 'packaged-dependency' | 'npm-dist-tag';
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
  const distTag = resolveCreateAtmDistTag(options.tag);
  writeDistTagSelection(targetRoot, distTag);

  const atmExecution = resolveAtmExecutionPlan(distTag.requestedTag);
  const steps: StepResult[] = [];
  steps.push(runAtmStep('bootstrap', atmExecution, ['bootstrap', '--cwd', targetRoot, '--json']));
  steps.push(runAtmStep('atm-chart render', atmExecution, ['atm-chart', 'render', '--cwd', targetRoot, '--json']));
  if (options.agent) {
    steps.push(runAtmStep(`agent-pack install ${options.agent}`, atmExecution, ['agent-pack', 'install', '--id', options.agent, '--cwd', targetRoot, '--json']));
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
      atmEntrypoint: atmExecution.display,
      atmEntrypointSource: atmExecution.source,
      distTag,
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
    tag: parseDistTag(readOption(args, '--tag') ?? 'latest'),
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

function parseDistTag(value: string): CreateAtmDistTag {
  if (value === 'latest' || value === 'next' || value === 'beta' || value === 'lts') {
    return value;
  }
  throwUsage(`--tag must be one of: latest, next, beta, lts. Got: ${value}`);
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

function resolveCreateAtmDistTag(tag: CreateAtmDistTag): CreateAtmDistTagSelection {
  const table: Record<CreateAtmDistTag, Omit<CreateAtmDistTagSelection, 'schemaVersion' | 'requestedTag' | 'npmPackageSpec' | 'source'>> = {
    latest: { tier: 'stable', expectedCliPrerelease: null },
    next: { tier: 'beta', expectedCliPrerelease: 'beta' },
    beta: { tier: 'experimental', expectedCliPrerelease: 'alpha' },
    lts: { tier: 'lts', expectedCliPrerelease: null }
  };
  return {
    schemaVersion: 'atm.distTagSelection.v0.1',
    requestedTag: tag,
    ...table[tag],
    npmPackageSpec: `@ai-atomic-framework/cli@${tag}`,
    source: 'create-atm'
  };
}

function writeDistTagSelection(targetRoot: string, selection: CreateAtmDistTagSelection): void {
  const selectionPath = path.join(targetRoot, '.atm', 'runtime', 'dist-tag.json');
  mkdirSync(path.dirname(selectionPath), { recursive: true });
  writeFileSync(selectionPath, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');
}

function resolveAtmExecutionPlan(tag: CreateAtmDistTag): AtmExecutionPlan {
  const require = createRequire(import.meta.url);
  try {
    const cliIndexPath = require.resolve('@ai-atomic-framework/cli');
    const packageRoot = path.resolve(path.dirname(cliIndexPath), '..');
    const packagedEntrypoint = path.join(packageRoot, 'dist', 'atm.mjs');
    if (existsSync(packagedEntrypoint) && tag === 'latest') {
      return {
        command: process.execPath,
        argsPrefix: [packagedEntrypoint],
        display: packagedEntrypoint,
        source: 'packaged-dependency'
      };
    }
  } catch {
    // Fall through to source-tree lookup.
  }

  const sourceTreeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const sourceEntrypoint = path.join(sourceTreeRoot, 'atm.mjs');
  if (existsSync(sourceEntrypoint)) {
    return {
      command: process.execPath,
      argsPrefix: [sourceEntrypoint],
      display: sourceEntrypoint,
      source: 'source-tree'
    };
  }

  if (tag !== 'latest') {
    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return {
      command: npxCommand,
      argsPrefix: ['--yes', `@ai-atomic-framework/cli@${tag}`, 'atm'],
      display: `${npxCommand} --yes @ai-atomic-framework/cli@${tag} atm`,
      source: 'npm-dist-tag'
    };
  }

  process.stderr.write('[create-atm] unable to locate ATM CLI entrypoint.\n');
  process.exit(1);
}

function runAtmStep(name: string, atmExecution: AtmExecutionPlan, args: readonly string[]): StepResult {
  const startedAt = Date.now();
  const child = spawnSync(atmExecution.command, [...atmExecution.argsPrefix, ...args], {
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

interface CreateAtmPayload {
  readonly messages?: ReadonlyArray<{ readonly text?: string }> | null;
}

function writePayload(payload: CreateAtmPayload, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const message = payload.messages?.[0]?.text ?? 'create-atm complete.';
  process.stdout.write(`[create-atm] ${message}\n`);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  process.exitCode = runCreateAtm();
}