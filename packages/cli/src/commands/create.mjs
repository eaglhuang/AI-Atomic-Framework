import path from 'node:path';
import { generateAtom } from '../../../core/src/manager/atom-generator.mjs';
import { CliError, makeResult, message } from './shared.mjs';

export function runCreate(argv) {
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
      testPath: result.testPath ?? null,
      registryPath: result.registryPath ?? null,
      catalogPath: result.catalogPath ?? null,
      allocation: result.allocation ?? null,
      phases: result.phases ?? []
    }
  });
}

function parseCreateOptions(argv) {
  const options = {
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

  for (const requiredOption of ['bucket', 'title', 'description']) {
    if (!options[requiredOption]) {
      throw new CliError('ATM_CLI_USAGE', `create requires --${requiredOption.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, { exitCode: 2 });
    }
  }

  return {
    options: {
      ...options,
      cwd: path.resolve(options.cwd)
    }
  };
}

function requireOptionValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `create requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}