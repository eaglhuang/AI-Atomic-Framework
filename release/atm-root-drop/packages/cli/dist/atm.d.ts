#!/usr/bin/env node
import { type CommandResult } from './commands/shared.ts';
export declare const cliCommandRunners: Record<string, (argv: string[]) => Promise<CommandResult | object> | CommandResult | object>;
export declare function runCli(argv?: string[], io?: {
    stdout: NodeJS.WriteStream & {
        fd: 1;
    };
    stderr: NodeJS.WriteStream & {
        fd: 2;
    };
}): Promise<number>;
