export declare function resetOutputProjectionGlobals(): void;
export declare function applyOutputProjectionFlagsFromArgv(argv: readonly string[]): void;
export declare function setOutputJsonPath(resolvedPath: string | null): void;
export declare function resolveNextDefaultOutputPath(cwd: string): string;
export declare const configRelativePath: string;
/**
 * Fallback framework version returned when no package.json is reachable from
 * `readFrameworkVersion`. Kept as a const so historical imports continue to
 * resolve; new code should call `readFrameworkVersion()` instead.
 */
export declare const frameworkVersion = "0.0.0";
/**
 * Centralized framework version reader. Reads `version` from the framework
 * package.json so the CLI and downstream consumers stay in sync with the
 * published manifest. Falls back to the bundled `frameworkVersion` constant
 * when package.json is missing or malformed.
 */
export declare function readFrameworkVersion(root?: string): string;
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
export declare class CliError extends Error {
    code: string;
    exitCode: number;
    details: Record<string, unknown>;
    constructor(code: string, text: string, options?: {
        exitCode?: number;
        details?: Record<string, unknown>;
    });
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
    userNotice?: Record<string, unknown> | null;
    runnerMode?: Record<string, unknown> | null;
    allowedCommands?: readonly string[];
    blockedCommands?: readonly string[];
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
export declare function projectToolBridgeFields(evidence: Record<string, unknown>): ToolBridgeProjection;
export declare function resolveCommandExitCode(input: {
    ok: boolean;
    messages?: readonly CommandMessage[];
    evidence?: Record<string, unknown>;
    cliErrorExitCode?: number;
}): number;
export declare function enrichCommandResult(result: CommandResult, options?: {
    cliErrorExitCode?: number;
}): EnrichedCommandResult;
export declare function message(level: MessageLevel | string, code: string, text: string, data?: unknown): CommandMessage;
export declare function resolveValue<T>(value: T | Promise<T>): Promise<T>;
export declare function makeResult({ ok, command, cwd, mode, messages, evidence }: {
    ok: boolean;
    command: string;
    cwd: string;
    mode?: string;
    messages?: CommandMessage[];
    evidence?: unknown;
}): CommandResult;
export declare function defineCommandSpec(spec: any): Readonly<{
    name: string;
    summary: string;
    positional: any[];
    options: any[];
    examples: any[];
}>;
type ParsedCommandArgs = {
    options: Record<string, unknown>;
    positional: string[];
    helpRequested: boolean;
    outputFormat: 'json' | 'pretty' | null;
    summary: boolean;
    fields: string[] | null;
};
export declare function parseArgsForCommand(spec: any, argv?: string[], options?: {
    allowUnknown?: boolean;
}): ParsedCommandArgs;
export declare function makeHelpResult(spec: any, cwd?: string): CommandResult;
export declare function writeResult(result: CommandResult, stream: {
    write(s: string): void;
}, outputFormat?: string, projectionOptions?: {
    summary?: boolean;
    fields?: string[] | null;
}): void;
export declare function formatPrettyResult(result: CommandResult): string;
export declare function quoteCliValue(value: unknown): string;
export declare function parseOptions(argv: string[], commandName: string): {
    options: {
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
    positional: string[];
};
export declare function configPathFor(cwd: string): string;
export declare function relativePathFrom(cwd: string, absolutePath: string): string;
export declare function ensureAtmDirectory(cwd: string): string;
export declare function readJsonFile(filePath: string, missingCode?: string): any;
export declare function writeJsonFile(filePath: string, value: unknown): void;
export declare function stripUtf8Bom(text: string): string;
export declare function parseJsonText(text: string): any;
export {};
