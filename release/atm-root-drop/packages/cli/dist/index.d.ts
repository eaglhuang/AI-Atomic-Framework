import type { AtomicPackageDescriptor } from '@ai-atomic-framework/core';
export declare const cliPackage: AtomicPackageDescriptor;
export interface CliCommandDescriptor {
    readonly commandName: string;
    readonly summary: string;
    readonly implemented: boolean;
    readonly standaloneMode: boolean;
    readonly outputFormat: 'json' | 'pretty+json';
}
export declare const plannedCliCommands: readonly CliCommandDescriptor[];
