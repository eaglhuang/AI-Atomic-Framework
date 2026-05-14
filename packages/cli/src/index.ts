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
  readonly outputFormat: 'json' | 'pretty+json';
}

export const plannedCliCommands: readonly CliCommandDescriptor[] = [
  {
    commandName: 'bootstrap',
    summary: 'Create the default ATM bootstrap pack and starter task',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'budget',
    summary: 'Evaluate ATM context budget policy against an estimated turn load',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'create',
    summary: 'Create and register a new atom through the provisioning facade',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'doctor',
    summary: 'Inspect ATM engineering readiness and trust signals',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'orient',
    summary: 'Inspect a repository and emit a guidance orientation report',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'start',
    summary: 'Start a goal-bound guidance session',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'explain',
    summary: 'Explain guidance blocks and missing evidence',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'guard',
    summary: 'Run small governance guards such as encoding checks',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'handoff',
    summary: 'Write a continuation summary for the current governed task',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'init',
    summary: 'Adopt ATM in a repository',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'lock',
    summary: 'Check, acquire, or release a governed scope lock',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'self-host-alpha',
    summary: 'Verify alpha0 self-hosting criteria',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'next',
    summary: 'Recommend the next official action from the current ATM state',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'spec',
    summary: 'Validate atomic specs against JSON Schema',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'status',
    summary: 'Inspect current governance state',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'upgrade',
    summary: 'Propose an evolution upgrade from report inputs',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'rollback',
    summary: 'Rollback a target atom or map to a specific historical version',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'review',
    summary: 'Review upgrade proposals and record human decisions',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'review-advisory',
    summary: 'Generate non-blocking semantic advisory findings for review context',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'test',
    summary: 'Run atom smoke tests',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'validate',
    summary: 'Run deterministic validation',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  },
  {
    commandName: 'verify',
    summary: 'Verify committed seed registry hashes and drift status',
    implemented: true,
    standaloneMode: true,
    outputFormat: 'pretty+json'
  }
];
