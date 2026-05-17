import path from 'node:path';
import { transitionReplacementMode } from '../../../core/src/registry/replacement-lane.ts';
import { getCommandSpec } from './command-specs.ts';
import { CliError, makeResult, message, parseArgsForCommand, relativePathFrom } from './shared.ts';

export async function runReplacementLane(argv: string[]) {
  const spec = getCommandSpec('replacement-lane');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for replacement-lane.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const [action = 'transition'] = parsed.positional;
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  if (action !== 'transition') {
    throw new CliError('ATM_CLI_USAGE', `replacement-lane does not support action ${action}`, {
      exitCode: 2,
      details: {
        supportedActions: ['transition']
      }
    });
  }

  const mapId = normalizeRequiredString(parsed.options.map, '--map');
  const to = normalizeRequiredString(parsed.options.to, '--to');
  const evidenceRefs = normalizeRepeatableStrings(parsed.options.evidence);
  const reason = normalizeOptionalString(parsed.options.reason);
  const actor = normalizeOptionalString(parsed.options.actor);
  const now = normalizeOptionalString(parsed.options.at);

  try {
    const result = transitionReplacementMode(mapId, to, {
      reason,
      evidenceRefs
    }, {
      repositoryRoot: cwd,
      actor,
      now
    });

    return makeResult({
      ok: true,
      command: 'replacement-lane',
      cwd,
      messages: [message('info', 'ATM_REPLACEMENT_LANE_TRANSITION_APPLIED', `Replacement lane moved ${mapId} from ${result.from} to ${result.to}.`)],
      evidence: {
        action,
        mapId,
        from: result.from,
        to: result.to,
        registryStatus: result.registryStatus,
        reason: result.reason,
        evidenceRefs: result.evidenceRefs,
        actor: result.actor,
        timestamp: result.timestamp,
        specPath: relativePathFrom(cwd, path.join(cwd, result.specPath)),
        registryPath: relativePathFrom(cwd, path.join(cwd, result.registryPath)),
        lineageLogPath: relativePathFrom(cwd, path.join(cwd, result.lineageLogPath)),
        transitionRecord: result.transitionRecord
      }
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      throw new CliError(String((error as any).code), error instanceof Error ? error.message : String(error), {
        details: (error as any).details ?? {}
      });
    }
    throw error;
  }
}

function normalizeRequiredString(value: unknown, flagName: string) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new CliError('ATM_CLI_USAGE', `replacement-lane requires ${flagName} <value>`, { exitCode: 2 });
  }
  return normalized;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() || null : null;
}

function normalizeRepeatableStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
}