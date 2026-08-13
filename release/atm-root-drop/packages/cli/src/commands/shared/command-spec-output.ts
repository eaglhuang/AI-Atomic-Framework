import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeCommandHelpMetadata } from '../help.ts';
import { projectFields, projectSummary } from '../output-projection.ts';
import { CliError, type CommandMessage, type CommandResult, type EnrichedCommandResult, enrichCommandResult, getOutputProjectionState, makeResult, message, setFieldsProjection, setOutputJsonPath, setSummaryProjection } from './result-core.ts';

export interface CommandOption {
  readonly flag: string;
  readonly value?: boolean;
  readonly repeatable?: boolean;
  readonly description?: string;
  readonly required?: boolean;
  readonly alias?: string;
  /**
   * ATM-GOV-0364 / ATM-BUG-2026-08-13-011. Which subcommands accept this flag.
   * Absent means "not yet declared", which is reported as such rather than
   * silently treated as "accepted everywhere" — an undeclared flag list is a
   * gap in the spec, not permission to show the caller all ninety of them.
   */
  readonly subcommands?: readonly string[];
}

export interface CommandSpecPositional {
  readonly name: string;
  readonly required?: boolean;
  readonly description?: string;
}

export interface CommandSpecExample {
  readonly description?: string;
  readonly command?: string;
}

export interface CommandSpecHelpMetadata {
  readonly header?: string;
  readonly footer?: string;
}

export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly positional?: readonly CommandSpecPositional[];
  readonly options?: readonly CommandOption[];
  readonly examples?: readonly CommandSpecExample[];
  readonly help?: CommandSpecHelpMetadata;
  readonly [key: string]: unknown;
}

export function defineCommandSpec(spec: unknown): CommandSpec {
  const specRecord = spec as Record<string, unknown> | null | undefined;
  const name = String(specRecord?.name || '').trim();
  if (!name) {
    throw new Error('Command spec requires a name.');
  }
  return Object.freeze({
    name,
    summary: String(specRecord?.summary || '').trim(),
    positional: normalizeSpecArray(specRecord?.positional),
    options: normalizeSpecArray(specRecord?.options),
    examples: normalizeSpecArray(specRecord?.examples),
    help: normalizeCommandHelpMetadata(specRecord?.help)
  }) as CommandSpec;
}

type ParsedCommandArgs = {
  options: Record<string, unknown>;
  positional: string[];
  helpRequested: boolean;
  outputFormat: 'json' | 'pretty' | null;
  summary: boolean;
  fields: string[] | null;
};

export function parseArgsForCommand(
  spec: CommandSpec,
  argv: string[] = [],
  options: { allowUnknown?: boolean } = {}
): ParsedCommandArgs {
  const state = {
    options: {} as Record<string, unknown>,
    positional: [] as string[],
    helpRequested: false,
    outputFormat: null as 'json' | 'pretty' | null,
    summary: false,
    fields: null as string[] | null
  };
  const allowUnknown = options.allowUnknown === true;
  const optionMap = buildOptionMap(spec.options ?? []);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      state.helpRequested = true;
      continue;
    }
    if (arg === '--json') {
      state.outputFormat = 'json';
      continue;
    }
    if (arg === '--pretty') {
      if (state.outputFormat !== 'json') {
        state.outputFormat = 'pretty';
      }
      continue;
    }
    if (arg === '--summary') {
      state.summary = true;
      setSummaryProjection(true);
      continue;
    }
    if (arg === '--fields') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--') || value === '-h') {
        const allowedFlags = [...new Set([...(spec.options ?? []).map((o) => o.flag), '--json', '--pretty', '--output-json', '--summary', '--fields'])].sort();
        throw new CliError('ATM_CLI_USAGE', `${spec.name || 'command'} requires a value for --fields`, {
          exitCode: 2,
          details: {
            invalidFlags: [],
            missingRequired: ['--fields'],
            allowedFlags,
            suggestedCommand: null
          }
        });
      }
      state.fields = value.split(',').map((entry) => entry.trim()).filter(Boolean);
      setFieldsProjection(state.fields);
      index += 1;
      continue;
    }
    if (arg === '--output-json') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--') || value === '-h') {
        const allowedFlags = [...new Set([...(spec.options ?? []).map((o) => o.flag), '--json', '--pretty', '--output-json'])].sort();
        throw new CliError('ATM_CLI_USAGE', `${spec.name || 'command'} requires a value for --output-json`, {
          exitCode: 2,
          details: {
            invalidFlags: [],
            missingRequired: ['--output-json'],
            allowedFlags,
            suggestedCommand: null
          }
        });
      }
      setOutputJsonPath(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--') || arg.startsWith('-')) {
      const optionSpec = optionMap.get(arg);
      if (!optionSpec) {
        if (allowUnknown) {
          state.positional.push(arg);
          continue;
        }
        const allowedFlags = [...new Set([...(spec.options ?? []).map((o) => o.flag), '--json', '--pretty', '--output-json'])].sort();
        const commandName = spec.name || 'command';
        // ATM-BUG-2026-07-12-151: low-level tasks close uses --status; taskflow close does not.
        if (commandName === 'taskflow' && arg === '--status') {
          const suggestedCommand = 'node atm.mjs taskflow close --task <id> --actor <actor> --write --json';
          throw new CliError(
            'ATM_CLI_USAGE',
            'taskflow does not support --status; omit it for taskflow close, or use `node atm.mjs tasks close --task <id> --actor <actor> --status done --json` for the low-level backend lane.',
            {
              exitCode: 2,
              details: {
                invalidFlags: [arg],
                missingRequired: [],
                allowedFlags,
                suggestedCommand,
                migrationHint: {
                  from: 'taskflow close --status done',
                  toTaskflow: suggestedCommand,
                  toLowLevel: 'node atm.mjs tasks close --task <id> --actor <actor> --status done --json'
                }
              }
            }
          );
        }
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option ${arg}`, {
          exitCode: 2,
          details: {
            invalidFlags: [arg],
            missingRequired: [],
            allowedFlags,
            suggestedCommand: null
          }
        });
      }

      const key = optionSpec.flag.replace(/^-+/, '').replace(/-([a-z])/g, (_: string, char: string) => char.toUpperCase());
      if (optionSpec.value) {
        const value = argv[index + 1];
        if (!value || value.startsWith('--') || value === '-h') {
          const allowedFlags = [...new Set([...(spec.options ?? []).map((o) => o.flag), '--json', '--pretty', '--output-json'])].sort();
          throw new CliError('ATM_CLI_USAGE', `${spec.name || 'command'} requires a value for ${optionSpec.flag}`, {
            exitCode: 2,
            details: {
              invalidFlags: [],
              missingRequired: [optionSpec.flag],
              allowedFlags,
              suggestedCommand: null
            }
          });
        }
        if (optionSpec.repeatable) {
          state.options[key] = Array.isArray(state.options[key]) ? [...state.options[key], value] : [value];
        } else {
          state.options[key] = value;
        }
        index += 1;
        continue;
      }

      state.options[key] = true;
      continue;
    }

    state.positional.push(arg);
  }

  return state;
}

/**
 * ATM-GOV-0364 / ATM-BUG-2026-08-13-011. Narrow a command's option list to the
 * flags a subcommand accepts.
 *
 * A flag is kept when it names this subcommand, and also when it names no
 * subcommand at all — an undeclared flag might belong here, and hiding a flag
 * that works is worse than showing one that does not. The distinction is
 * reported rather than hidden: the caller is told how many options were
 * declared for this subcommand and how many are still undeclared, so an
 * unfiltered list reads as an incomplete spec instead of as an answer.
 */
export function scopeOptionsToSubcommand(
  options: readonly CommandOption[],
  subcommand: string
): { readonly options: readonly CommandOption[]; readonly declared: number; readonly undeclared: number } {
  const target = subcommand.trim();
  if (!target) return { options, declared: 0, undeclared: options.length };
  let declared = 0;
  let undeclared = 0;
  const kept: CommandOption[] = [];
  for (const option of options) {
    const owners = option.subcommands;
    if (!owners || owners.length === 0) {
      undeclared += 1;
      kept.push(option);
      continue;
    }
    if (owners.includes(target)) {
      declared += 1;
      kept.push(option);
    }
  }
  return { options: kept, declared, undeclared };
}

export function makeHelpResult(spec: CommandSpec, cwd = process.cwd(), subcommand?: string) {
  const allOptions = spec.options ?? [];
  const scoped = subcommand ? scopeOptionsToSubcommand(allOptions, subcommand) : null;
  const usage = {
    command: spec.name,
    summary: spec.summary,
    positional: spec.positional ?? [],
    options: scoped ? scoped.options : allOptions,
    examples: spec.examples ?? [],
    ...(spec.help ? { help: spec.help } : {}),
    ...(scoped
      ? {
        subcommand,
        optionScope: {
          schemaId: 'atm.commandOptionScope.v1',
          subcommand,
          declaredForSubcommand: scoped.declared,
          undeclaredOwnership: scoped.undeclared,
          totalCommandOptions: allOptions.length,
          note: scoped.declared === 0
            ? `No option in ${spec.name} declares ownership by "${subcommand}" yet, so every flag is still listed. Declaring subcommand ownership on the spec narrows this.`
            : `${scoped.declared} option(s) declare "${subcommand}"; ${scoped.undeclared} more have not declared ownership and are listed conservatively.`
        }
      }
      : {})
  };
  return makeResult({
    ok: true,
    command: spec.name,
    cwd,
    messages: [message('info', 'ATM_CLI_HELP_READY', subcommand ? `Help for ${spec.name} ${subcommand}.` : `Help for ${spec.name}.`)],
    evidence: {
      usage
    }
  });
}

export function writeResult(
  result: CommandResult,
  stream: { write(s: string): void },
  outputFormat = 'json',
  projectionOptions?: { summary?: boolean; fields?: string[] | null }
) {
  const enriched = 'severity' in result && 'exitCode' in result && 'blocking' in result && 'diagnostics' in result
    ? result as EnrichedCommandResult
    : enrichCommandResult(result);
  let projectedResult = enriched;
  const projectionState = getOutputProjectionState();
  const summary = projectionOptions?.summary ?? projectionState.summary;
  const fields = projectionOptions?.fields ?? projectionState.fields;

  if (fields && fields.length > 0) {
    projectedResult = {
      ...projectFields(enriched, fields),
      severity: enriched.severity,
      exitCode: enriched.exitCode,
      blocking: enriched.blocking,
      diagnostics: enriched.diagnostics
    };
  } else if (summary) {
    projectedResult = {
      ...projectSummary(enriched),
      severity: enriched.severity,
      exitCode: enriched.exitCode,
      blocking: enriched.blocking,
      diagnostics: enriched.diagnostics
    };
  }

  if (projectionState.outputJsonPath) {
    try {
      const resolved = path.resolve(projectionState.outputJsonPath);
      const dir = path.dirname(resolved);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(resolved, `${JSON.stringify(projectedResult, null, 2)}\n`, 'utf8');
    } catch (err) {
      process.stderr.write(`Error writing output JSON to ${projectionState.outputJsonPath}: ${err}\n`);
    }
    if (outputFormat === 'pretty') {
      stream.write(formatPrettyResult(projectedResult));
    }
    return;
  }
  if (outputFormat === 'pretty') {
    stream.write(formatPrettyResult(projectedResult));
    return;
  }
  stream.write(`${JSON.stringify(projectedResult, null, 2)}\n`);
}

export function formatPrettyResult(result: CommandResult) {
  const statusText = result.ok ? 'OK' : 'FAIL';
  const lines = [`[${statusText}] ${result.command} (${result.cwd})`];
  for (const entry of result.messages ?? []) {
    lines.push(`${entry.level}: ${entry.code} - ${entry.text}`);
  }
  if (result.evidence && Object.keys(result.evidence).length > 0) {
    lines.push('evidence:');
    lines.push(JSON.stringify(result.evidence, null, 2));
  }
  return `${lines.join('\n')}\n`;
}

export function quoteCliValue(value: unknown) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeSpecArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? value.map((entry) => entry as T) : [];
}

function buildOptionMap(options: readonly CommandOption[]) {
  const map = new Map<string, CommandOption>();
  for (const option of options) {
    if (option?.flag) {
      map.set(option.flag, option);
    }
    if (option?.alias) {
      map.set(option.alias, option);
    }
  }
  return map;
}
