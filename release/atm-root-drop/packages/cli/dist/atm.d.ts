#!/usr/bin/env node
export declare const cliCommandRunners: Record<string, (argv: any) => any>;
export declare function runCli(argv?: string[], io?: {
    stdout: NodeJS.WriteStream & {
        fd: 1;
    };
    stderr: NodeJS.WriteStream & {
        fd: 2;
    };
}): Promise<number>;
