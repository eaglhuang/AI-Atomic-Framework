import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCommandHelpMetadata } from './help.ts';
import { projectFields, projectSummary } from './output-projection.ts';

let outputJsonPath: string | null = null;
let globalSummaryProjection = false;
let globalFieldsProjection: string[] | null = null;

export function resetOutputProjectionGlobals(): void {
  outputJsonPath = null;
  globalSummaryProjection = false;
  globalFieldsProjection = null;
}

export function applyOutputProjectionFlagsFromArgv(argv: readonly string[]): void {
  resetOutputProjectionGlobals();
  const summaryIdx = argv.indexOf('--summary');
  if (summaryIdx !== -1) {
    globalSummaryProjection = true;
  }
  const fieldsIdx = argv.indexOf('--fields');
  if (fieldsIdx !== -1 && fieldsIdx + 1 < argv.length && !argv[fieldsIdx + 1].startsWith('-')) {
    globalFieldsProjection = argv[fieldsIdx + 1].split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  const outputJsonIdx = argv.indexOf('--output-json');
  if (outputJsonIdx !== -1 && outputJsonIdx + 1 < argv.length && !argv[outputJsonIdx + 1].startsWith('-')) {
    outputJsonPath = argv[outputJsonIdx + 1];
  }
}

export function setOutputJsonPath(resolvedPath: string | null): void {
  outputJsonPath = resolvedPath;
}

export function resolveNextDefaultOutputPath(cwd: string): string {
  const dir = path.join(path.resolve(cwd), '.atm-temp');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `next-${stamp}.json`);
}

// 在載入時直接全域掃描一次 process.argv 以備不時之需
const outputJsonIdx = process.argv.indexOf('--output-json');
if (outputJsonIdx !== -1 && outputJsonIdx + 1 < process.argv.length) {
  outputJsonPath = process.argv[outputJsonIdx + 1];
}
const summaryIdx = process.argv.indexOf('--summary');
if (summaryIdx !== -1) {
  globalSummaryProjection = true;
}
const fieldsIdx = process.argv.indexOf('--fields');
if (fieldsIdx !== -1 && fieldsIdx + 1 < process.argv.length) {
  globalFieldsProjection = process.argv[fieldsIdx + 1].split(',').map((entry) => entry.trim()).filter(Boolean);
}

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

export interface ToolBridgeProjection {
  nextAction?: Record<string, unknown> | null;
  taskIntent?: Record<string, unknown> | null;
  userNotice?: Record<string, unknown> | null;
  runnerMode?: Record<string, unknown> | null;
  frameworkReport?: Record<string, unknown> | null;
  frameworkClaim?: Record<string, unknown> | null;
  evidenceSummary?: Record<string, unknown> | null;
  guardReport?: Record<string, unknown> | null;
  taskflowReadiness?: Record<string, unknown> | null;
  commitBundle?: Record<string, unknown> | null;
  allowedCommands?: readonly string[];
  blockedCommands?: readonly string[];
  skillGrowth?: Record<string, unknown> | null;
}

/** Public CLI result severity — part of the machine-readable result contract. */
export type CliResultSeverity = 'success' | 'advisory' | 'blocked' | 'usage-error' | 'failure';

export interface CliResultDiagnostics {
  errorCodes: string[];
  warningCodes: string[];
  infoCodes: string[];
}

/** Normalized CLI envelope fields appended to every command result. */
export interface EnrichedCommandResult extends CommandResult, ToolBridgeProjection {
  severity: CliResultSeverity;
  exitCode: number;
  blocking: boolean;
  diagnostics: CliResultDiagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

export function projectToolBridgeFields(evidence: Record<string, unknown>): ToolBridgeProjection {
  if (evidence.suppressToolBridgeProjection === true) {
    return {};
  }
  const nextAction = isRecord(evidence.nextAction) ? evidence.nextAction : null;
  const taskIntent = isRecord(evidence.taskIntent) ? evidence.taskIntent : null;
  const userNotice = isRecord(evidence.userNotice) ? evidence.userNotice : null;
  const runnerMode = isRecord(evidence.runnerMode)
    ? evidence.runnerMode
    : nextAction && isRecord(nextAction.runnerMode)
      ? nextAction.runnerMode
      : null;
  const frameworkReport = isRecord(evidence.report)
    && typeof evidence.action === 'string'
    && ((evidence.report as Record<string, unknown>).schemaId === 'atm.frameworkDevelopmentStatus')
      ? evidence.report as Record<string, unknown>
      : null;
  const frameworkClaim = typeof evidence.action === 'string' && evidence.action === 'claim'
    ? {
      action: 'claim',
      taskId: typeof evidence.taskId === 'string' ? evidence.taskId : null,
      actorId: typeof evidence.actorId === 'string' ? evidence.actorId : null,
      reason: typeof evidence.reason === 'string' ? evidence.reason : null,
      linkedTaskId: typeof evidence.linkedTaskId === 'string' ? evidence.linkedTaskId : null,
      files: readStringList(evidence.files) ?? [],
      lock: isRecord(evidence.lock) ? evidence.lock : null
    }
    : null;
  const evidenceSummary = typeof evidence.action === 'string' && (evidence.action === 'add' || evidence.action === 'run')
    ? {
      action: evidence.action,
      taskId: typeof evidence.taskId === 'string' ? evidence.taskId : null,
      actorId: typeof evidence.actorId === 'string' ? evidence.actorId : null,
      kind: typeof evidence.kind === 'string' ? evidence.kind : null,
      evidencePath: typeof evidence.evidencePath === 'string' ? evidence.evidencePath : null,
      bundleManifestPath: typeof evidence.bundleManifestPath === 'string' ? evidence.bundleManifestPath : null,
      artifactPaths: isRecord(evidence.bundleManifest) ? readStringList((evidence.bundleManifest as Record<string, unknown>).artifactPaths) ?? [] : [],
      freshValidationPasses: isRecord(evidence.bundleManifest) ? readStringList((evidence.bundleManifest as Record<string, unknown>).freshValidationPasses) ?? [] : [],
      commandRunCount: typeof evidence.commandRunCount === 'number' ? evidence.commandRunCount : null,
      commandRunCache: isRecord(evidence.commandRunCache) ? evidence.commandRunCache : null
    }
    : null;
  const guardReport = typeof evidence.guard === 'string'
    ? {
      guard: evidence.guard,
      taskId: typeof evidence.taskId === 'string' ? evidence.taskId : null,
      actorId: typeof evidence.actorId === 'string' ? evidence.actorId : null,
      files: readStringList(evidence.files) ?? [],
      violations: Array.isArray(evidence.violations) ? evidence.violations : [],
      findings: Array.isArray(evidence.findings) ? evidence.findings : [],
      report: isRecord(evidence.report) ? evidence.report : null,
      claimLeaseId: typeof evidence.claimLeaseId === 'string' ? evidence.claimLeaseId : null,
      failOpen: evidence.failOpen === true
    }
    : null;
  const taskflowReadiness = isRecord(evidence.writeReadinessHint) || isRecord(evidence.historicalClosePreflight)
    ? {
      writeReadinessHint: isRecord(evidence.writeReadinessHint) ? evidence.writeReadinessHint : null,
      historicalClosePreflight: isRecord(evidence.historicalClosePreflight) ? evidence.historicalClosePreflight : null,
      autoEvidencePlan: isRecord(evidence.autoEvidencePlan) ? evidence.autoEvidencePlan : null,
      closebackPathResolution: isRecord(evidence.closebackPathResolution) ? evidence.closebackPathResolution : null,
      closeMode: typeof evidence.closeMode === 'string' ? evidence.closeMode : null
    }
    : null;
  const commitBundle = isRecord(evidence.commitBundle)
    ? evidence.commitBundle
    : isRecord(evidence.governedCommitBundle)
      ? evidence.governedCommitBundle
      : null;
  const skillGrowth = isRecord(evidence.skillGrowth)
    ? evidence.skillGrowth
    : nextAction && isRecord(nextAction.skillGrowth)
      ? nextAction.skillGrowth
      : null;
  const allowedCommands = readStringList(evidence.allowedCommands)
    ?? (nextAction ? readStringList(nextAction.allowedCommands) : undefined);
  const blockedCommands = readStringList(evidence.blockedCommands)
    ?? (nextAction ? readStringList(nextAction.blockedCommands) : undefined);
  return {
    nextAction,
    taskIntent,
    userNotice,
    runnerMode,
    frameworkReport,
    frameworkClaim,
    evidenceSummary,
    guardReport,
    taskflowReadiness,
    commitBundle,
    allowedCommands,
    blockedCommands,
    skillGrowth
  };
}

const BLOCKED_ACTION_MESSAGE_CODES = new Set([
  'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED',
  'ATM_GUIDANCE_NEXT_BLOCKED',
  'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED',
  'ATM_NEXT_CLAIM_BLOCKED',
  'ATM_BROKER_LIFECYCLE_BLOCKED',
  'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED',
  'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED',
  'ATM_TASKFLOW_CLOSE_WRITE_BLOCKED'
]);

const USAGE_ERROR_MESSAGE_CODES = new Set([
  'ATM_CLI_USAGE',
  'ATM_CLI_UNKNOWN_COMMAND',
  'ATM_CLI_HELP_NOT_FOUND'
]);

function collectMessageCodes(messages: readonly CommandMessage[], level: string): string[] {
  return messages
    .filter((entry) => entry.level === level)
    .map((entry) => entry.code)
    .filter((code) => typeof code === 'string' && code.length > 0);
}

function hasBlockedActionSignal(result: CommandResult): boolean {
  const nextAction = result.evidence?.nextAction as { status?: string } | undefined;
  if (nextAction?.status === 'blocked') {
    return true;
  }
  return result.messages.some((entry) => {
    if (entry.level !== 'error') {
      return false;
    }
    if (BLOCKED_ACTION_MESSAGE_CODES.has(entry.code)) {
      return true;
    }
    return /_BLOCKED$/.test(entry.code) && !USAGE_ERROR_MESSAGE_CODES.has(entry.code);
  });
}

function resolveSeverityFromResult(result: CommandResult, exitCode: number): CliResultSeverity {
  if (exitCode === 2) {
    return 'usage-error';
  }
  if (!result.ok) {
    return hasBlockedActionSignal(result) ? 'blocked' : 'failure';
  }
  const warningCodes = collectMessageCodes(result.messages, 'warn');
  if (warningCodes.length > 0) {
    return 'advisory';
  }
  return 'success';
}

export function resolveCommandExitCode(input: {
  ok: boolean;
  messages?: readonly CommandMessage[];
  evidence?: Record<string, unknown>;
  cliErrorExitCode?: number;
}): number {
  if (typeof input.cliErrorExitCode === 'number') {
    return input.cliErrorExitCode;
  }
  if (input.ok) {
    return 0;
  }
  const errorCodes = collectMessageCodes(input.messages ?? [], 'error');
  if (errorCodes.some((code) => USAGE_ERROR_MESSAGE_CODES.has(code))) {
    return 2;
  }
  return 1;
}

export function enrichCommandResult(
  result: CommandResult,
  options: { cliErrorExitCode?: number } = {}
): EnrichedCommandResult {
  const exitCode = resolveCommandExitCode({
    ok: result.ok,
    messages: result.messages,
    evidence: result.evidence,
    cliErrorExitCode: options.cliErrorExitCode
  });
  const severity = resolveSeverityFromResult(result, exitCode);
  const diagnostics: CliResultDiagnostics = {
    errorCodes: collectMessageCodes(result.messages, 'error'),
    warningCodes: collectMessageCodes(result.messages, 'warn'),
    infoCodes: collectMessageCodes(result.messages, 'info')
  };
  const blocking = severity === 'blocked' || severity === 'failure' || severity === 'usage-error';
  const toolBridge = projectToolBridgeFields(result.evidence);
  return {
    ...result,
    ...toolBridge,
    severity,
    exitCode,
    blocking,
    diagnostics
  };
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

export interface CommandOption {
  readonly flag: string;
  readonly value?: boolean;
  readonly repeatable?: boolean;
  readonly description?: string;
  readonly required?: boolean;
  readonly alias?: string;
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
      globalSummaryProjection = true;
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
      globalFieldsProjection = state.fields;
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
      outputJsonPath = value;
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
        throw new CliError('ATM_CLI_USAGE', `${spec.name || 'command'} does not support option ${arg}`, {
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

export function makeHelpResult(spec: CommandSpec, cwd = process.cwd()) {
  const usage = {
    command: spec.name,
    summary: spec.summary,
    positional: spec.positional ?? [],
    options: spec.options ?? [],
    examples: spec.examples ?? [],
    ...(spec.help ? { help: spec.help } : {})
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
  const summary = projectionOptions?.summary ?? globalSummaryProjection;
  const fields = projectionOptions?.fields ?? globalFieldsProjection;

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

  if (outputJsonPath) {
    try {
      const resolved = path.resolve(outputJsonPath);
      const dir = path.dirname(resolved);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(resolved, `${JSON.stringify(projectedResult, null, 2)}\n`, 'utf8');
    } catch (err) {
      process.stderr.write(`Error writing output JSON to ${outputJsonPath}: ${err}\n`);
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

const ALLOWED_FLAGS_MAP: Record<string, string[]> = {
  doctor: ['--ci-profile', '--skip-check'],
  spec: ['--spec', '--validate'],
  verify: ['--spec', '--self', '--neutrality', '--agents-md', '--guards', '--evidence'],
  'self-host-alpha': ['--verify', '--agent'],
  next: ['--spec', '--claim', '--tasks', '--actor', '--prompt', '--intent', '--task'],
  batch: ['--batch', '--scope', '--compact', '--hold', '--actor', '--reason', '--task'],
  quickfix: ['--actor', '--prompt', '--files', '--reason'],
  init: ['--spec', '--dry-run', '--adopt', '--integration', '--task'],
  bootstrap: ['--spec', '--task'],
  test: ['--atom', '--spec', '--profile', '--suite', '--map', '--equivalence-fixtures', '--fingerprint-check', '--edge-contracts', '--propagate'],
  welcome: ['--dry-run'],
  status: [],
  validate: ['--spec'],
  integration: ['--integration']
};

function getAllowedFlags(commandName: string): string[] {
  const custom = ALLOWED_FLAGS_MAP[commandName] || [];
  const defaults = ['--cwd', '--force', '--json', '--pretty', '--output-json', '--summary', '--fields'];
  return [...new Set([...custom, ...defaults])].sort();
}

function createUsageError(
  commandName: string,
  messageText: string,
  options: { invalidFlags?: string[]; missingRequired?: string[] } = {}
): CliError {
  const allowedFlags = getAllowedFlags(commandName);
  return new CliError('ATM_CLI_USAGE', messageText, {
    exitCode: 2,
    details: {
      invalidFlags: options.invalidFlags ?? [],
      missingRequired: options.missingRequired ?? [],
      allowedFlags,
      suggestedCommand: null
    }
  });
}

type ParsedCliOptions = {
  cwd: string;
  ciProfile?: string;
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
  profile?: string;
  suite?: string;
  agent?: string;
  prompt?: string;
  intent?: string;
  files: string[];
  reason?: string;
  skipChecks: string[];
  outputJson?: string;
  summary: boolean;
  fields: string[] | null;
};

export function parseOptions(argv: string[], commandName: string) {
  const options: ParsedCliOptions = {
    cwd: process.cwd(),
    ciProfile: undefined,
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
    profile: undefined,
    suite: undefined,
    fingerprintCheck: false,
    edgeContracts: false,
    agent: undefined,
    prompt: undefined,
    intent: undefined,
    files: [],
    reason: undefined,
    skipChecks: [],
    outputJson: undefined,
    summary: false,
    fields: null
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-json') {
      options.outputJson = requireOptionValue(argv, index, '--output-json', commandName);
      outputJsonPath = options.outputJson ?? null;
      index += 1;
      continue;
    }
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd', commandName);
      index += 1;
      continue;
    }
    if (arg === '--ci-profile') {
      if (commandName !== 'doctor') {
        throw createUsageError(commandName, `${commandName} does not support option --ci-profile`, { invalidFlags: ['--ci-profile'] });
      }
      options.ciProfile = requireOptionValue(argv, index, '--ci-profile', commandName);
      index += 1;
      continue;
    }
    if (arg === '--skip-check') {
      if (commandName !== 'doctor') {
        throw createUsageError(commandName, `${commandName} does not support option --skip-check`, { invalidFlags: ['--skip-check'] });
      }
      const raw = requireOptionValue(argv, index, '--skip-check', commandName);
      options.skipChecks = options.skipChecks.concat(raw.split(',').map((entry: string) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === '--spec') {
      if (!['spec', 'init', 'bootstrap', 'validate', 'test'].includes(commandName)) {
        throw createUsageError(commandName, `${commandName} does not support option --spec`, { invalidFlags: ['--spec'] });
      }
      options.spec = requireOptionValue(argv, index, '--spec', commandName);
      index += 1;
      continue;
    }
    if (arg === '--profile') {
      if (commandName !== 'test') {
        throw createUsageError(commandName, `${commandName} does not support option --profile`, { invalidFlags: ['--profile'] });
      }
      options.profile = requireOptionValue(argv, index, '--profile', commandName);
      index += 1;
      continue;
    }
    if (arg === '--suite') {
      if (commandName !== 'test') {
        throw createUsageError(commandName, `${commandName} does not support option --suite`, { invalidFlags: ['--suite'] });
      }
      options.suite = requireOptionValue(argv, index, '--suite', commandName);
      index += 1;
      continue;
    }
    if (arg === '--validate') {
      if (commandName !== 'spec') {
        throw createUsageError(commandName, `${commandName} does not support option --validate`, { invalidFlags: ['--validate'] });
      }
      options.validate = requireOptionValue(argv, index, '--validate', commandName);
      index += 1;
      continue;
    }
    if (arg === '--self') {
      if (commandName !== 'verify') {
        throw createUsageError(commandName, `${commandName} does not support option --self`, { invalidFlags: ['--self'] });
      }
      options.self = true;
      continue;
    }
    if (arg === '--neutrality') {
      if (commandName !== 'verify') {
        throw createUsageError(commandName, `${commandName} does not support option --neutrality`, { invalidFlags: ['--neutrality'] });
      }
      options.neutrality = true;
      continue;
    }
    if (arg === '--agents-md') {
      if (commandName !== 'verify') {
        throw createUsageError(commandName, `${commandName} does not support option --agents-md`, { invalidFlags: ['--agents-md'] });
      }
      options.agentsMd = true;
      continue;
    }
    if (arg === '--guards') {
      if (commandName !== 'verify') {
        throw createUsageError(commandName, `${commandName} does not support option --guards`, { invalidFlags: ['--guards'] });
      }
      options.guards = true;
      continue;
    }
    if (arg === '--evidence') {
      if (commandName !== 'verify') {
        throw createUsageError(commandName, `${commandName} does not support option --evidence`, { invalidFlags: ['--evidence'] });
      }
      options.evidence = requireOptionValue(argv, index, '--evidence', commandName);
      index += 1;
      continue;
    }
    if (arg === '--verify') {
      if (commandName !== 'self-host-alpha') {
        throw createUsageError(commandName, `${commandName} does not support option --verify`, { invalidFlags: ['--verify'] });
      }
      options.verify = true;
      continue;
    }
    if (arg === '--agent') {
      if (commandName !== 'self-host-alpha') {
        throw createUsageError(commandName, `${commandName} does not support option --agent`, { invalidFlags: ['--agent'] });
      }
      options.agent = requireOptionValue(argv, index, '--agent', commandName);
      index += 1;
      continue;
    }
    if (arg === '--claim') {
      if (commandName !== 'next') {
        throw createUsageError(commandName, `${commandName} does not support option --claim`, { invalidFlags: ['--claim'] });
      }
      options.claim = true;
      continue;
    }
    if (arg === '--tasks') {
      if (commandName !== 'next') {
        throw createUsageError(commandName, `${commandName} does not support option --tasks`, { invalidFlags: ['--tasks'] });
      }
      const raw = requireOptionValue(argv, index, '--tasks', commandName);
      options.tasks = raw.split(',').map((entry: string) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--batch') {
      if (commandName !== 'batch') {
        throw createUsageError(commandName, `${commandName} does not support option --batch`, { invalidFlags: ['--batch'] });
      }
      options.batch = requireOptionValue(argv, index, '--batch', commandName);
      index += 1;
      continue;
    }
    if (arg === '--scope') {
      if (commandName !== 'batch') {
        throw createUsageError(commandName, `${commandName} does not support option --scope`, { invalidFlags: ['--scope'] });
      }
      options.scope = requireOptionValue(argv, index, '--scope', commandName);
      index += 1;
      continue;
    }
    if (arg === '--compact') {
      if (commandName !== 'batch') {
        throw createUsageError(commandName, `${commandName} does not support option --compact`, { invalidFlags: ['--compact'] });
      }
      options.compact = true;
      continue;
    }
    if (arg === '--hold') {
      if (commandName !== 'batch') {
        throw createUsageError(commandName, `${commandName} does not support option --hold`, { invalidFlags: ['--hold'] });
      }
      options.hold = true;
      continue;
    }
    if (arg === '--actor') {
      if (!['next', 'batch', 'quickfix'].includes(commandName)) {
        throw createUsageError(commandName, `${commandName} does not support option --actor`, { invalidFlags: ['--actor'] });
      }
      options.agent = requireOptionValue(argv, index, '--actor', commandName);
      index += 1;
      continue;
    }
    if (arg === '--prompt') {
      if (!['next', 'quickfix'].includes(commandName)) {
        throw createUsageError(commandName, `${commandName} does not support option --prompt`, { invalidFlags: ['--prompt'] });
      }
      options.prompt = requireOptionValue(argv, index, '--prompt', commandName);
      index += 1;
      continue;
    }
    if (arg === '--intent') {
      if (commandName !== 'next') {
        throw createUsageError(commandName, `${commandName} does not support option --intent`, { invalidFlags: ['--intent'] });
      }
      options.intent = requireOptionValue(argv, index, '--intent', commandName);
      index += 1;
      continue;
    }
    if (arg === '--files') {
      if (!['next', 'quickfix'].includes(commandName)) {
        throw createUsageError(commandName, `${commandName} does not support option --files`, { invalidFlags: ['--files'] });
      }
      const raw = requireOptionValue(argv, index, '--files', commandName);
      options.files = raw.split(',').map((entry: string) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      if (!['batch', 'quickfix'].includes(commandName)) {
        throw createUsageError(commandName, `${commandName} does not support option --reason`, { invalidFlags: ['--reason'] });
      }
      options.reason = requireOptionValue(argv, index, '--reason', commandName);
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      if (commandName !== 'init') {
        throw createUsageError(commandName, `${commandName} does not support option --dry-run`, { invalidFlags: ['--dry-run'] });
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
        throw createUsageError(commandName, `${commandName} does not support option --adopt`, { invalidFlags: ['--adopt'] });
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
        throw createUsageError(commandName, `${commandName} does not support option --integration`, { invalidFlags: ['--integration'] });
      }
      options.integration = requireOptionValue(argv, index, '--integration', commandName);
      index += 1;
      continue;
    }
    if (arg === '--atom') {
      if (commandName !== 'test') {
        throw createUsageError(commandName, `${commandName} does not support option --atom`, { invalidFlags: ['--atom'] });
      }
      options.atom = requireOptionValue(argv, index, '--atom', commandName);
      index += 1;
      continue;
    }
    if (arg === '--map') {
      if (commandName !== 'test') {
        throw createUsageError(commandName, `${commandName} does not support option --map`, { invalidFlags: ['--map'] });
      }
      options.map = requireOptionValue(argv, index, '--map', commandName);
      index += 1;
      continue;
    }
    if (arg === '--equivalence-fixtures') {
      if (commandName !== 'test') {
        throw createUsageError(commandName, `${commandName} does not support option --equivalence-fixtures`, { invalidFlags: ['--equivalence-fixtures'] });
      }
      options.equivalenceFixtures = requireOptionValue(argv, index, '--equivalence-fixtures', commandName);
      index += 1;
      continue;
    }
    if (arg === '--fingerprint-check') {
      if (commandName !== 'test') {
        throw createUsageError(commandName, `${commandName} does not support option --fingerprint-check`, { invalidFlags: ['--fingerprint-check'] });
      }
      options.fingerprintCheck = true;
      continue;
    }
    if (arg === '--edge-contracts') {
      if (!['test'].includes(commandName)) {
        throw createUsageError(commandName, `${commandName} does not support option --edge-contracts`, { invalidFlags: ['--edge-contracts'] });
      }
      options.edgeContracts = true;
      continue;
    }
    if (arg === '--propagate') {
      if (commandName !== 'test') {
        throw createUsageError(commandName, `${commandName} does not support option --propagate`, { invalidFlags: ['--propagate'] });
      }
      options.propagate = requireOptionValue(argv, index, '--propagate', commandName);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      if (!['init', 'bootstrap', 'next', 'tasks', 'batch'].includes(commandName)) {
        throw createUsageError(commandName, `${commandName} does not support option --task`, { invalidFlags: ['--task'] });
      }
      options.task = requireOptionValue(argv, index, '--task', commandName);
      index += 1;
      continue;
    }
    if (arg === '--summary') {
      options.summary = true;
      globalSummaryProjection = true;
      continue;
    }
    if (arg === '--fields') {
      const raw = requireOptionValue(argv, index, '--fields', commandName);
      options.fields = raw.split(',').map((entry: string) => entry.trim()).filter(Boolean);
      globalFieldsProjection = options.fields;
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw createUsageError(commandName, `${commandName} does not support option ${arg}`, { invalidFlags: [arg] });
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

function requireOptionValue(argv: string[], optionIndex: number, optionName: string, commandName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw createUsageError(commandName, `${commandName} requires a value for ${optionName}`, { missingRequired: [optionName] });
  }
  return value;
}
