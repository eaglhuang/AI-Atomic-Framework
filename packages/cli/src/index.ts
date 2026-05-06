import type { AtomicPackageDescriptor } from '@ai-atomic-framework/core';

export const cliPackage: AtomicPackageDescriptor = {
  packageName: '@ai-atomic-framework/cli',
  packageRole: 'cli-entrypoints',
  packageVersion: '0.0.0'
};

export interface CliCommandDescriptor {
  readonly commandName: string;
  readonly summary: string;
  readonly implemented: boolean;
}

export const plannedCliCommands: readonly CliCommandDescriptor[] = [
  { commandName: 'init', summary: 'Adopt ATM in a repository', implemented: false },
  { commandName: 'status', summary: 'Inspect current governance state', implemented: false },
  { commandName: 'validate', summary: 'Run deterministic validation', implemented: false }
];