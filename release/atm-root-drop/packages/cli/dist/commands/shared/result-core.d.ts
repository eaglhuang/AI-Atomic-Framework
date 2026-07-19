export declare function resetOutputProjectionGlobals(): void;
export declare function applyOutputProjectionFlagsFromArgv(argv: readonly string[]): void;
export declare function setOutputJsonPath(resolvedPath: string | null): void;
export declare function resolveNextDefaultOutputPath(cwd: string): string;
export declare const configRelativePath: string;
export declare const frameworkVersion = "0.0.0";
export declare function readFrameworkVersion(root?: string): string;
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
export type CliResultSeverity = 'success' | 'advisory' | 'blocked' | 'usage-error' | 'failure';
export interface CliResultDiagnostics {
    errorCodes: string[];
    warningCodes: string[];
    infoCodes: string[];
}
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
export declare function setSummaryProjection(enabled: boolean): void;
export declare function setFieldsProjection(fields: string[] | null): void;
export declare function getOutputProjectionState(): {
    outputJsonPath: string | null;
    summary: boolean;
    fields: string[] | null;
};
