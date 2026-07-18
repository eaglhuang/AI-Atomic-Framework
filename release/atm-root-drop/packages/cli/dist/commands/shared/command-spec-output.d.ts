import { type CommandResult } from './result-core.ts';
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
export declare function defineCommandSpec(spec: unknown): CommandSpec;
type ParsedCommandArgs = {
    options: Record<string, unknown>;
    positional: string[];
    helpRequested: boolean;
    outputFormat: 'json' | 'pretty' | null;
    summary: boolean;
    fields: string[] | null;
};
export declare function parseArgsForCommand(spec: CommandSpec, argv?: string[], options?: {
    allowUnknown?: boolean;
}): ParsedCommandArgs;
export declare function makeHelpResult(spec: CommandSpec, cwd?: string): CommandResult;
export declare function writeResult(result: CommandResult, stream: {
    write(s: string): void;
}, outputFormat?: string, projectionOptions?: {
    summary?: boolean;
    fields?: string[] | null;
}): void;
export declare function formatPrettyResult(result: CommandResult): string;
export declare function quoteCliValue(value: unknown): string;
export {};
