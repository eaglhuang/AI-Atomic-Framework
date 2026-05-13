import path from 'node:path';
import { generateAtom } from '../../../core/src/manager/atom-generator.ts';
import { CliError, makeResult, message } from './shared.ts';

export function runCreate(argv: any) {
  const { options } = parseCreateOptions(argv);
  const result = generateAtom({
    bucket: options.bucket,
    title: options.title,
    description: options.description,
    logicalName: options.logicalName
  }, {
    repositoryRoot: options.cwd,
    dryRun: options.dryRun
  });

  return makeResult({
    ok: result.ok,
    command: 'create',
    cwd: options.cwd,
    messages: [
      result.ok
        ? message('info', options.dryRun ? 'ATM_CREATE_DRY_RUN_OK' : 'ATM_CREATE_OK', options.dryRun ? 'Atom create dry-run completed.' : 'Atom created and registered.', { atomId: result.atomId })
        : message('error', result.error?.code ?? 'ATM_CREATE_FAILED', result.error?.message ?? 'Atom creation failed.', result.error?.details ?? {})
    ],
    evidence: {
      atomId: result.atomId,
      dryRun: options.dryRun,
      idempotent: result.idempotent === true,
      workbenchPath: result.workbenchPath ?? null,
      specPath: result.specPath ?? null,
      sourcePath: result.sourcePath ?? null,
      testPath: result.testPath ?? null,
      registryPath: result.registryPath ?? null,
      catalogPath: result.catalogPath ?? null,
      allocation: result.allocation ?? null,
      phases: result.phases ?? []
    }
  });
}

type CreateOptions = {
  cwd: string;
  bucket: string | null;
  title: string | null;
  description: string | null;
  logicalName: string | null;
  dryRun: boolean;
};

function parseCreateOptions(argv: any) {
  const options: CreateOptions = {
    cwd: process.cwd(),
    bucket: null,
    title: null,
    description: null,
    logicalName: null,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--bucket') {
      options.bucket = requireOptionValue(argv, index, '--bucket');
      index += 1;
      continue;
    }
    if (arg === '--title') {
      options.title = requireOptionValue(argv, index, '--title');
      index += 1;
      continue;
    }
    if (arg === '--description') {
      options.description = requireOptionValue(argv, index, '--description');
      index += 1;
      continue;
    }
    if (arg === '--logical-name') {
      options.logicalName = requireOptionValue(argv, index, '--logical-name');
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `create does not support option ${arg}`, { exitCode: 2 });
  }

  if (!options.bucket) {
    throw new CliError('ATM_CLI_USAGE', 'create requires --bucket', { exitCode: 2 });
  }
  if (!options.title) {
    throw new CliError('ATM_CLI_USAGE', 'create requires --title', { exitCode: 2 });
  }
  if (!options.description) {
    throw new CliError('ATM_CLI_USAGE', 'create requires --description', { exitCode: 2 });
  }

  return {
    options: {
      ...options,
      cwd: path.resolve(options.cwd)
    }
  };
}

function requireOptionValue(argv: any, optionIndex: any, optionName: any) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `create requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
