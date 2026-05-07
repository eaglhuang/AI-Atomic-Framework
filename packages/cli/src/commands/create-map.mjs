import path from 'node:path';
import { generateAtomicMap } from '../../../core/src/manager/map-generator.mjs';
import { CliError, makeResult, message } from './shared.mjs';

export function runCreateMap(argv) {
  const { options } = parseCreateMapOptions(argv);
  const result = generateAtomicMap({
    mapVersion: options.mapVersion,
    members: options.members,
    edges: options.edges,
    entrypoints: options.entrypoints,
    qualityTargets: options.qualityTargets
  }, {
    repositoryRoot: options.cwd,
    dryRun: options.dryRun
  });

  return makeResult({
    ok: result.ok,
    command: 'create-map',
    cwd: options.cwd,
    messages: [
      result.ok
        ? message('info', options.dryRun ? 'ATM_CREATE_MAP_DRY_RUN_OK' : 'ATM_CREATE_MAP_OK', options.dryRun ? 'Atomic map create dry-run completed.' : 'Atomic map created and registered.', { mapId: result.mapId })
        : message('error', result.error?.code ?? 'ATM_CREATE_MAP_FAILED', result.error?.message ?? 'Atomic map creation failed.', result.error?.details ?? {})
    ],
    evidence: {
      mapId: result.mapId,
      dryRun: options.dryRun,
      idempotent: result.idempotent === true,
      workbenchPath: result.workbenchPath ?? null,
      specPath: result.specPath ?? null,
      testPath: result.testPath ?? null,
      reportPath: result.reportPath ?? null,
      registryPath: result.registryPath ?? null,
      catalogPath: result.catalogPath ?? null,
      allocation: result.allocation ?? null,
      phases: result.phases ?? []
    }
  });
}

function parseCreateMapOptions(argv) {
  const options = {
    cwd: process.cwd(),
    mapVersion: '0.1.0',
    members: null,
    edges: [],
    entrypoints: null,
    qualityTargets: null,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--map-version') {
      options.mapVersion = requireOptionValue(argv, index, '--map-version');
      index += 1;
      continue;
    }
    if (arg === '--members') {
      options.members = parseJsonOption(requireOptionValue(argv, index, '--members'), '--members');
      index += 1;
      continue;
    }
    if (arg === '--edges') {
      options.edges = parseJsonOption(requireOptionValue(argv, index, '--edges'), '--edges');
      index += 1;
      continue;
    }
    if (arg === '--entrypoints') {
      options.entrypoints = parseJsonOption(requireOptionValue(argv, index, '--entrypoints'), '--entrypoints');
      index += 1;
      continue;
    }
    if (arg === '--quality-targets') {
      options.qualityTargets = parseJsonOption(requireOptionValue(argv, index, '--quality-targets'), '--quality-targets');
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
    throw new CliError('ATM_CLI_USAGE', `create-map does not support option ${arg}`, { exitCode: 2 });
  }

  for (const requiredOption of ['members', 'entrypoints', 'qualityTargets']) {
    if (options[requiredOption] == null) {
      throw new CliError('ATM_CLI_USAGE', `create-map requires --${requiredOption.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, { exitCode: 2 });
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
    throw new CliError('ATM_CLI_USAGE', `create-map requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function parseJsonOption(rawValue, optionName) {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new CliError('ATM_JSON_INVALID', `Invalid JSON for ${optionName}.`, {
      exitCode: 2,
      details: {
        optionName,
        reason: error instanceof Error ? error.message : String(error)
      }
    });
  }
}