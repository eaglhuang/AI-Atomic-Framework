import path from 'node:path';
import { generateAtomicMap } from '../../../core/src/manager/map-generator.ts';
import { createAtomicMapRequestFromDecompositionPlan, readDecompositionPlan } from '../../../core/src/registry/decomposition-plan.ts';
import { validateAtomicSpecFileAgainstSchema } from './spec-shared.ts';
import { CliError, makeResult, message, quoteCliValue, readJsonFile, relativePathFrom } from './shared.ts';

export function runCreateMap(argv: any) {
  const { options } = parseCreateMapOptions(argv);
  const input = resolveCreateMapInput(options);
  const result = generateAtomicMap(input.request, {
    repositoryRoot: options.cwd,
    dryRun: options.dryRun,
    mapId: input.mapId
  });
  const failureCode = input.sourceMode === 'spec'
    ? 'ATM_MAP_SPEC_INVALID'
    : (result.error?.code ?? 'ATM_CREATE_MAP_FAILED');
  const failureText = input.sourceMode === 'spec'
    ? `Atomic map spec input is invalid: ${result.error?.message ?? 'create-map --spec failed.'}`
    : (result.error?.message ?? 'Atomic map creation failed.');

  return makeResult({
    ok: result.ok,
    command: 'create-map',
    cwd: options.cwd,
    messages: [
      result.ok
        ? message('info', options.dryRun ? 'ATM_CREATE_MAP_DRY_RUN_OK' : 'ATM_CREATE_MAP_OK', options.dryRun ? 'Atomic map create dry-run completed.' : 'Atomic map created and registered.', { mapId: result.mapId })
        : message('error', failureCode, failureText, result.error?.details ?? {})
    ],
    evidence: {
      mapId: result.mapId,
      sourceMode: input.sourceMode,
      sourcePath: input.sourcePath,
      defaultsUsed: input.defaultsUsed,
      nextActionHint: buildCreateMapNextActionHint(options.cwd, result.mapId, options.dryRun),
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

function buildCreateMapNextActionHint(cwd: string, mapId: string | null | undefined, dryRun: boolean) {
  if (dryRun || !mapId) {
    return null;
  }
  return {
    status: 'ready',
    route: 'map-integration-test',
    reason: 'Canonical map workspace is ready; run the integration test before replacement-lane promotion.',
    command: `node atm.mjs test --cwd ${quoteCliValue(cwd)} --map ${quoteCliValue(mapId)} --json`,
    producesEvidenceKind: 'map-integration'
  };
}

type CreateMapOptions = {
  cwd: string;
  mapVersion: string;
  specPath: string | null;
  fromPlanPath: string | null;
  members: unknown[] | null;
  edges: unknown[];
  entrypoints: unknown[] | null;
  qualityTargets: Record<string, unknown> | null;
  dryRun: boolean;
};

function parseCreateMapOptions(argv: any) {
  const options: CreateMapOptions = {
    cwd: process.cwd(),
    mapVersion: '0.1.0',
    specPath: null,
    fromPlanPath: null,
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
    if (arg === '--spec') {
      options.specPath = requireOptionValue(argv, index, '--spec');
      index += 1;
      continue;
    }
    if (arg === '--from-plan') {
      options.fromPlanPath = requireOptionValue(argv, index, '--from-plan');
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

  const activeModes = [
    options.specPath ? 'spec' : null,
    options.fromPlanPath ? 'from-plan' : null,
    options.members != null || options.entrypoints != null || options.qualityTargets != null ? 'inline' : null
  ].filter(Boolean);
  if (activeModes.length !== 1) {
    throw new CliError('ATM_CLI_USAGE', 'create-map requires exactly one input mode: inline JSON, --spec <path>, or --from-plan <path>.', { exitCode: 2 });
  }

  if (activeModes[0] === 'inline') {
    if (options.members == null) {
      throw new CliError('ATM_CLI_USAGE', 'create-map requires --members', { exitCode: 2 });
    }
    if (options.entrypoints == null) {
      throw new CliError('ATM_CLI_USAGE', 'create-map requires --entrypoints', { exitCode: 2 });
    }
    if (options.qualityTargets == null) {
      throw new CliError('ATM_CLI_USAGE', 'create-map requires --quality-targets', { exitCode: 2 });
    }
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
    throw new CliError('ATM_CLI_USAGE', `create-map requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function parseJsonOption(rawValue: any, optionName: any) {
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

function resolveCreateMapInput(options: CreateMapOptions) {
  if (options.specPath) {
    return loadCreateMapInputFromSpec(options.cwd, options.specPath);
  }
  if (options.fromPlanPath) {
    let loaded;
    try {
      loaded = readDecompositionPlan(options.fromPlanPath, { cwd: options.cwd });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'ATM_DECOMP_PLAN_INVALID') {
        throw new CliError('ATM_DECOMP_PLAN_INVALID', error instanceof Error ? error.message : String(error), {
          exitCode: 2,
          details: (error as any).details ?? {}
        });
      }
      throw error;
    }
    const converted = createAtomicMapRequestFromDecompositionPlan(loaded.plan);
    return {
      mapId: converted.mapId,
      request: converted.request,
      sourceMode: 'from-plan',
      sourcePath: loaded.relativePlanPath,
      defaultsUsed: converted.defaultsUsed
    };
  }

  return {
    mapId: null,
    request: {
      mapVersion: options.mapVersion,
      members: options.members,
      edges: options.edges,
      entrypoints: options.entrypoints,
      qualityTargets: options.qualityTargets
    },
    sourceMode: 'inline',
    sourcePath: null,
    defaultsUsed: []
  };
}

function loadCreateMapInputFromSpec(cwd: string, specPath: string) {
  const absoluteSpecPath = path.resolve(cwd, specPath);
  const validation = validateCreateMapSpecInput(cwd, specPath, absoluteSpecPath);
  if (!validation.ok) {
    throw new CliError('ATM_MAP_SPEC_INVALID', 'create-map --spec requires a valid atm.atomicMap document.', {
      exitCode: 2,
      details: {
        specPath: relativePathFrom(cwd, absoluteSpecPath),
        validationMessages: validation.messages
      }
    });
  }
  const document = readJsonFile(absoluteSpecPath, 'ATM_MAP_SPEC_INVALID') as Record<string, any>;
  if (document?.schemaId !== 'atm.atomicMap') {
    throw new CliError('ATM_MAP_SPEC_INVALID', 'create-map --spec requires an atm.atomicMap document.', {
      exitCode: 2,
      details: {
        specPath: relativePathFrom(cwd, absoluteSpecPath),
        schemaId: document?.schemaId ?? null
      }
    });
  }
  if (typeof document?.mapId !== 'string' || document.mapId.trim().length === 0) {
    throw new CliError('ATM_MAP_SPEC_INVALID', 'create-map --spec requires mapId on the source document.', {
      exitCode: 2,
      details: {
        specPath: relativePathFrom(cwd, absoluteSpecPath)
      }
    });
  }

  return {
    mapId: document.mapId,
    request: {
      mapVersion: document.mapVersion,
      specVersion: document.specVersion,
      members: document.members,
      edges: document.edges,
      entrypoints: document.entrypoints,
      qualityTargets: document.qualityTargets,
      replacement: document.replacement,
      pendingSfCalculation: document.pendingSfCalculation === true
    },
    sourceMode: 'spec',
    sourcePath: relativePathFrom(cwd, absoluteSpecPath),
    defaultsUsed: []
  };
}

function validateCreateMapSpecInput(cwd: string, specPath: string, absoluteSpecPath: string) {
  try {
    return validateAtomicSpecFileAgainstSchema(cwd, specPath, {
      commandName: 'create-map',
      successCode: 'ATM_MAP_SPEC_VALIDATE_OK',
      successText: 'Atomic map spec validated against JSON Schema.'
    });
  } catch (error) {
    if (error instanceof CliError) {
      return makeResult({
        ok: false,
        command: 'create-map',
        cwd,
        messages: [message('error', 'ATM_MAP_SPEC_INVALID', error.message, {
          specPath: relativePathFrom(cwd, absoluteSpecPath),
          code: error.code,
          ...(Object.keys(error.details ?? {}).length > 0 ? { details: error.details } : {})
        })],
        evidence: {
          specPath: relativePathFrom(cwd, absoluteSpecPath),
          validated: []
        }
      });
    }
    throw error;
  }
}
