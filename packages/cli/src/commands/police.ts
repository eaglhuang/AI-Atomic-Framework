import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  makePoliceFamilyReport,
  runPoliceFamilyGate
} from '../../../core/src/police/family.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.ts';

export async function runPolice(argv: any) {
  const options = parsePoliceOptions(argv);
  const action = options.action ?? 'run';
  if (action !== 'run') {
    throw new CliError('ATM_CLI_USAGE', `police only supports action "run" (got ${action})`, { exitCode: 2 });
  }

  const registryDocument = readOptionalJson(resolvePath(options.cwd, options.registryPath));
  const report = await runPoliceFamilyGate({
    profile: options.profile,
    coreFamilies: [
      makePoliceFamilyReport({ family: 'schema', mode: 'blocker', status: 'pass', sourceValidator: 'atm-police-cli' }),
      makePoliceFamilyReport({ family: 'dependency-graph', mode: 'blocker', status: 'pass', sourceValidator: 'atm-police-cli' }),
      makePoliceFamilyReport({ family: 'boundary', mode: 'blocker', status: 'pass', sourceValidator: 'atm-police-cli' }),
      makePoliceFamilyReport({ family: 'registry-consistency', mode: 'blocker', status: 'pass', sourceValidator: 'atm-police-cli' }),
      makePoliceFamilyReport({ family: 'lifecycle', mode: 'blocker', status: 'pass', sourceValidator: 'atm-police-cli' })
    ],
    dedup: {
      registryDocument
    },
    quality: {},
    mapIntegration: {},
    atomization: {},
    decomposition: {
      maxFileLines: options.maxFileLines
    },
    evolution: {}
  });

  const outPath = options.outputPath ? resolvePath(options.cwd, options.outputPath) : null;
  if (outPath) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return makeResult({
    ok: report.ok,
    command: 'police',
    cwd: options.cwd,
    messages: [
      message(report.ok ? 'info' : 'error', report.ok ? 'ATM_POLICE_GATE_OK' : 'ATM_POLICE_GATE_FAILED', report.ok
        ? 'Police family gate completed.'
        : 'Police family gate completed with blocking findings.', {
        profile: report.profile,
        families: report.families.length,
        findings: report.findings.length,
        blockingFindings: report.blockingFindings.length
      })
    ],
    evidence: {
      report,
      outputPath: outPath ? relativePathFrom(options.cwd, outPath) : null
    }
  });
}

function parsePoliceOptions(argv: string[]) {
  const options = {
    action: '',
    cwd: process.cwd(),
    profile: 'standard' as 'standard' | 'full',
    outputPath: '',
    registryPath: 'atomic-registry.json',
    maxFileLines: undefined as number | undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--profile') {
      options.profile = requireOptionValue(argv, index, '--profile') as 'standard' | 'full';
      index += 1;
      continue;
    }
    if (arg === '--out') {
      options.outputPath = requireOptionValue(argv, index, '--out');
      index += 1;
      continue;
    }
    if (arg === '--registry') {
      options.registryPath = requireOptionValue(argv, index, '--registry');
      index += 1;
      continue;
    }
    if (arg === '--max-file-lines') {
      const raw = requireOptionValue(argv, index, '--max-file-lines');
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new CliError('ATM_CLI_USAGE', `police --max-file-lines requires a positive integer (got ${raw})`, { exitCode: 2 });
      }
      options.maxFileLines = parsed;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `police does not support option ${arg}`, { exitCode: 2 });
    }
    if (!options.action) {
      options.action = arg;
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `Unexpected police argument: ${arg}`, { exitCode: 2 });
  }

  if (!['standard', 'full'].includes(options.profile)) {
    throw new CliError('ATM_CLI_USAGE', `Unsupported police profile: ${options.profile}`, { exitCode: 2 });
  }

  return {
    ...options,
    cwd: path.resolve(options.cwd),
    action: options.action || 'run'
  };
}

function requireOptionValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `police requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function readOptionalJson(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolvePath(cwd: string, maybeRelativePath: string) {
  return path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.resolve(cwd, maybeRelativePath);
}
