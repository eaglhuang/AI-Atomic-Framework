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
  readonly standaloneMode: boolean;
  readonly outputFormat: 'json';
}

export const plannedCliCommands: readonly CliCommandDescriptor[] = [
  {
    commandName: 'bootstrap',
    summary: 'Create the default ATM bootstrap pack and starter task',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'json'
  },
  {
    commandName: 'init',
    summary: 'Adopt ATM in a repository',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'json'
  },
  {
    commandName: 'status',
    summary: 'Inspect current governance state',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'json'
  },
  {
    commandName: 'validate',
    summary: 'Run deterministic validation',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'json'
  }
];