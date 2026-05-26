import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const configRelativePath = path.join('.atm', 'config.json');

/**
 * Fallback framework version returned when no package.json is reachable from
 * `readFrameworkVersion`. Kept as a const so historical imports continue to
 * resolve; new code should call `readFrameworkVersion()` instead.
 */
export const frameworkVersion = '0.0.0';

/**
 * Default framework root used by `readFrameworkVersion` when no override
 * is supplied. Resolves four levels up from this module (packages/cli/src/commands).
 */
const defaultFrameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

/**
 * Centralized framework version reader. Reads `version` from the framework
 * package.json so the CLI and downstream consumers stay in sync with the
 * published manifest. Falls back to the bundled `frameworkVersion` constant
 * when package.json is missing or malformed.
 */
export function readFrameworkVersion(root: string = defaultFrameworkRoot): string {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) {
    return frameworkVersion;
  }
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      return parsed.version;
    }
  } catch {
    // fall through to bundled fallback
  }
  return frameworkVersion;
}

/**
 * Public error policy for ATM CLI commands.
 *
 * Every command that fails MUST throw a `CliError` (not a raw `Error`).
 * The CLI runtime catches it and translates it into a deterministic JSON
 * envelope: `{ ok: false, messages: [{ level: 'error', code, text, data }] }`
 * with the process exit code set to `error.exitCode`.
 *
 * Exit code policy:
 *   - `1` (default) — runtime failure, environment problem, validator failure.
 *     Reserved for "something went wrong while doing the work".
 *   - `2` — usage error: bad CLI arguments, unknown subcommand, missing
 *     required `--flag`, attempted action on uninitialized repo (where the
 *     fix is "run the right command first"). Reserved for "the invocation
 *     itself was wrong".
 *
 * Code policy: `code` is a stable `SCREAMING_SNAKE_CASE` token prefixed with
 * `ATM_`. Codes are part of the public CLI contract (I1) — release-smoke
 * fixtures pin them, downstream automation may switch on them. Renaming a
 * code is a breaking change.
 *
 * Details policy: `details` is a plain object that becomes the message
 * `data` field. Keys should be camelCase. Values should be JSON-serializable.
 * Do not put `Error` instances or class instances in details.
 */
export class CliError extends Error {
  code: string;
  exitCode: number;
  details: Record<string, unknown>;

  constructor(code: string, text: string, options: { exitCode?: number; details?: Record<string, unknown> } = {}) {
    super(text);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? {};
  }
}

export type MessageLevel = 'info' | 'warn' | 'error';

export interface CommandMessage {
  level: MessageLevel | string;
  code: string;
  text: string;
  data: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  command: string;
  mode: string;
  cwd: string;
  messages: CommandMessage[];
  evidence: Record<string, unknown>;
}

export function message(level: MessageLevel | string, code: string, text: string, data: unknown = {}): CommandMessage {
  return { level, code, text, data: data as Record<string, unknown> };
}

export async function resolveValue<T>(value: T | Promise<T>): Promise<T> {
  return await Promise.resolve(value);
}

export function makeResult({ ok, command, cwd, mode = 'standalone', messages = [], evidence = {} }: {
  ok: boolean;
  command: string;
  cwd: string;
  mode?: string;
  messages?: CommandMessage[];
  evidence?: unknown;
}): CommandResult {
  return { ok, command, mode, cwd, messages, evidence: evidence as Record<string, unknown> };
}

export function defineCommandSpec(spec: any) {
  const name = String(spec?.name || '').trim();
  if (!name) {
    throw new Error('Command spec requires a name.');
  }
  return Object.freeze({
    name,
    summary: String(spec?.summary || '').trim(),
    positional: normalizeSpecArray(spec?.positional),
    options: normalizeSpecArray(spec?.options),
    examples: normalizeSpecArray(spec?.examples)
  });
}

type ParsedCommandArgs = {
  options: Record<string, unknown>;
  positional: string[];
  helpRequested: boolean;
  outputFormat: 'json' | 'pretty' | null;
};

export function parseArgsForCommand(
  spec: any,
  argv: string[] = [],
  options: { allowUnknown?: boolean } = {}
): ParsedCommandArgs {
  const state = {
    options: {} as Record<string, unknown>,
    positional: [] as string[],
    helpRequested: false,
    outputFormat: null as 'json' | 'pretty' | null
  };
  const allowUnknown = options.allowUnknown === true;
  const optionMap = buildOptionMap(spec?.options ?? []);

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

    if (arg.startsWith('--') || arg.startsWith('-')) {
      const optionSpec = optionMap.get(arg);
      if (!optionSpec) {
        if (allowUnknown) {
          state.positional.push(arg);
          continue;
        }
        throw new CliError('ATM_CLI_USAGE', `${spec?.name || 'command'} does not support option ${arg}`, { exitCode: 2 });
      }

      const key = optionSpec.flag.replace(/^-+/, '').replace(/-([a-z])/g, (_: any, char: any) => char.toUpperCase());
      if (optionSpec.value) {
        const value = argv[index + 1];
        if (!value || value.startsWith('--') || value === '-h') {
          throw new CliError('ATM_CLI_USAGE', `${spec?.name || 'command'} requires a value for ${optionSpec.flag}`, { exitCode: 2 });
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

export function makeHelpResult(spec: any, cwd = process.cwd()) {
  const usage = {
    command: spec.name,
    summary: spec.summary,
    positional: spec.positional ?? [],
    options: spec.options ?? [],
    examples: spec.examples ?? []
  };
  return makeResult({
    ok: true,
    command: spec.name,
    cwd,
    messages: [message('info', 'ATM_CLI_HELP_READY', `Help for ${spec.name}.`)],
    evidence: {
      usage
    }
  });
}

export function writeResult(result: CommandResult, stream: { write(s: string): void }, outputFormat = 'json') {
  if (outputFormat === 'pretty') {
    stream.write(formatPrettyResult(result));
    return;
  }
  stream.write(`${JSON.stringify(result, null, 2)}\n`);
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

type ParsedCliOptions = {
  cwd: string;
  spec?: string;
  validate?: string;
  self: boolean;
  neutrality: boolean;
  agentsMd: boolean;
  guards: boolean;
  evidence?: string;
  verify: boolean;
  claim: boolean;
  dryRun: boolean;
  force: boolean;
  adopt?: string;
  integration?: string;
  task?: string;
  tasks: string[];
  batch?: string;
  scope?: string;
  compact?: boolean;
  hold?: boolean;
  atom?: string;
  map?: string;
  equivalenceFixtures?: string;
  fingerprintCheck?: boolean;
  edgeContracts?: boolean;
  propagate?: string;
  agent?: string;
  prompt?: string;
  intent?: string;
  files: string[];
  reason?: string;
};

export function parseOptions(argv: string[], commandName: string) {
  const options: ParsedCliOptions = {
    cwd: process.cwd(),
    spec: undefined,
    validate: undefined,
    self: false,
    neutrality: false,
    agentsMd: false,
    guards: false,
    evidence: undefined,
    verify: false,
    claim: false,
    dryRun: false,
    force: false,
    adopt: undefined,
    integration: undefined,
    task: undefined,
    tasks: [],
    batch: undefined,
    scope: undefined,
    compact: false,
    hold: false,
    atom: undefined,
    map: undefined,
    propagate: undefined,
    fingerprintCheck: false,
    edgeContracts: false,
    agent: undefined,
    prompt: undefined,
    intent: undefined,
    files: [],
    reason: undefined
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd', commandName);
      index += 1;
      continue;
    }
    if (arg === '--spec') {
      options.spec = requireOptionValue(argv, index, '--spec', commandName);
      index += 1;
      continue;
    }
    if (arg === '--validate') {
      if (commandName !== 'spec') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --validate`, { exitCode: 2 });
      }
      options.validate = requireOptionValue(argv, index, '--validate', commandName);
      index += 1;
      continue;
    }
    if (arg === '--self') {
      if (commandName !== 'verify') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --self`, { exitCode: 2 });
      }
      options.self = true;
      continue;
    }
    if (arg === '--neutrality') {
      if (commandName !== 'verify') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --neutrality`, { exitCode: 2 });
      }
      options.neutrality = true;
      continue;
    }
    if (arg === '--agents-md') {
      if (commandName !== 'verify') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --agents-md`, { exitCode: 2 });
      }
      options.agentsMd = true;
      continue;
    }
    if (arg === '--guards') {
      if (commandName !== 'verify') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --guards`, { exitCode: 2 });
      }
      options.guards = true;
      continue;
    }
    if (arg === '--evidence') {
      if (commandName !== 'verify') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --evidence`, { exitCode: 2 });
      }
      options.evidence = requireOptionValue(argv, index, '--evidence', commandName);
      index += 1;
      continue;
    }
    if (arg === '--verify') {
      if (commandName !== 'self-host-alpha') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --verify`, { exitCode: 2 });
      }
      options.verify = true;
      continue;
    }
    if (arg === '--agent') {
      if (commandName !== 'self-host-alpha') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --agent`, { exitCode: 2 });
      }
      options.agent = requireOptionValue(argv, index, '--agent', commandName);
      index += 1;
      continue;
    }
    if (arg === '--claim') {
      if (commandName !== 'next') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --claim`, { exitCode: 2 });
      }
      options.claim = true;
      continue;
    }
    if (arg === '--tasks') {
      if (commandName !== 'next') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --tasks`, { exitCode: 2 });
      }
      const raw = requireOptionValue(argv, index, '--tasks', commandName);
      options.tasks = raw.split(',').map((entry: string) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--batch') {
      if (commandName !== 'batch') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --batch`, { exitCode: 2 });
      }
      options.batch = requireOptionValue(argv, index, '--batch', commandName);
      index += 1;
      continue;
    }
    if (arg === '--scope') {
      if (commandName !== 'batch') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --scope`, { exitCode: 2 });
      }
      options.scope = requireOptionValue(argv, index, '--scope', commandName);
      index += 1;
      continue;
    }
    if (arg === '--compact') {
      if (commandName !== 'batch') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --compact`, { exitCode: 2 });
      }
      options.compact = true;
      continue;
    }
    if (arg === '--hold') {
      if (commandName !== 'batch') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --hold`, { exitCode: 2 });
      }
      options.hold = true;
      continue;
    }
    if (arg === '--actor') {
      if (!['next', 'batch', 'quickfix'].includes(commandName)) {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --actor`, { exitCode: 2 });
      }
      options.agent = requireOptionValue(argv, index, '--actor', commandName);
      index += 1;
      continue;
    }
    if (arg === '--prompt') {
      if (!['next', 'quickfix'].includes(commandName)) {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --prompt`, { exitCode: 2 });
      }
      options.prompt = requireOptionValue(argv, index, '--prompt', commandName);
      index += 1;
      continue;
    }
    if (arg === '--intent') {
      if (commandName !== 'next') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --intent`, { exitCode: 2 });
      }
      options.intent = requireOptionValue(argv, index, '--intent', commandName);
      index += 1;
      continue;
    }
    if (arg === '--files') {
      if (commandName !== 'quickfix') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --files`, { exitCode: 2 });
      }
      const raw = requireOptionValue(argv, index, '--files', commandName);
      options.files = raw.split(',').map((entry: string) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      if (!['batch', 'quickfix'].includes(commandName)) {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --reason`, { exitCode: 2 });
      }
      options.reason = requireOptionValue(argv, index, '--reason', commandName);
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      if (commandName !== 'init') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --dry-run`, { exitCode: 2 });
      }
      options.dryRun = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--adopt') {
      if (commandName !== 'init') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --adopt`, { exitCode: 2 });
      }
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        options.adopt = 'default';
      } else {
        options.adopt = requireOptionValue(argv, index, '--adopt', commandName);
        index += 1;
      }
      continue;
    }
    if (arg === '--integration') {
      if (commandName !== 'init') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --integration`, { exitCode: 2 });
      }
      options.integration = requireOptionValue(argv, index, '--integration', commandName);
      index += 1;
      continue;
    }
    if (arg === '--atom') {
      if (commandName !== 'test') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --atom`, { exitCode: 2 });
      }
      options.atom = requireOptionValue(argv, index, '--atom', commandName);
      index += 1;
      continue;
    }
    if (arg === '--map') {
      if (commandName !== 'test') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --map`, { exitCode: 2 });
      }
      options.map = requireOptionValue(argv, index, '--map', commandName);
      index += 1;
      continue;
    }
    if (arg === '--equivalence-fixtures') {
      if (commandName !== 'test') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --equivalence-fixtures`, { exitCode: 2 });
      }
      options.equivalenceFixtures = requireOptionValue(argv, index, '--equivalence-fixtures', commandName);
      index += 1;
      continue;
    }
    if (arg === '--fingerprint-check') {
      if (commandName !== 'test') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --fingerprint-check`, { exitCode: 2 });
      }
      options.fingerprintCheck = true;
      continue;
    }
    if (arg === '--edge-contracts') {
      if (!['test'].includes(commandName)) {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --edge-contracts`, { exitCode: 2 });
      }
      options.edgeContracts = true;
      continue;
    }
    if (arg === '--propagate') {
      if (commandName !== 'test') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --propagate`, { exitCode: 2 });
      }
      options.propagate = requireOptionValue(argv, index, '--propagate', commandName);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      if (commandName !== 'init' && commandName !== 'bootstrap') {
        throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option --task`, { exitCode: 2 });
      }
      options.task = requireOptionValue(argv, index, '--task', commandName);
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `${commandName} does not support option ${arg}`, { exitCode: 2 });
    }
    positional.push(arg);
  }

  return {
    options: {
      ...options,
      cwd: path.resolve(options.cwd)
    },
    positional
  };
}

export function configPathFor(cwd: string) {
  return path.join(cwd, configRelativePath);
}

export function relativePathFrom(cwd: string, absolutePath: string) {
  return path.relative(cwd, absolutePath).replace(/\\/g, '/');
}

export function ensureAtmDirectory(cwd: string) {
  const directory = path.join(cwd, '.atm');
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function readJsonFile(filePath: string, missingCode = 'ATM_JSON_NOT_FOUND') {
  if (!existsSync(filePath)) {
    throw new CliError(missingCode, `JSON file not found: ${filePath}`, { details: { filePath } });
  }
  try {
    return parseJsonText(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new CliError('ATM_JSON_INVALID', `Invalid JSON file: ${filePath}`, {
      details: {
        filePath,
        reason: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

export function writeJsonFile(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function stripUtf8Bom(text: string) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

export function parseJsonText(text: string) {
  return JSON.parse(stripUtf8Bom(text));
}

function normalizeSpecArray(value: any) {
  return Array.isArray(value) ? value.map((entry) => entry) : [];
}

function buildOptionMap(options: any) {
  const map = new Map();
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

function requireOptionValue(argv: any, optionIndex: any, optionName: any, commandName: any) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `${commandName} requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
