#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptsDir);

interface Step {
  readonly title: string;
  readonly commands: readonly [string, string[], { cwd: string }][];
}

const steps: Step[] = [
  {
    title: 'Sync main branch',
    commands: [
      ['git', ['switch', 'main'], { cwd: root }],
      ['git', ['pull', '--ff-only', 'origin', 'main'], { cwd: root }],
    ],
  },
  {
    title: 'Install dependencies',
    commands: [
      [npmCommand, ['ci'], { cwd: root }],
    ],
  },
  {
    title: 'Run standard validation',
    commands: [
      [npmCommand, ['run', 'validate:standard'], { cwd: root }],
    ],
  },
  {
    title: 'Run regression checks',
    commands: [
      [npmCommand, ['test'], { cwd: root }],
      ['node', [fileURLToPath(new URL('../atm.mjs', import.meta.url)), 'verify', '--neutrality', '--json'], { cwd: root }],
      ['node', [fileURLToPath(new URL('../atm.mjs', import.meta.url)), 'verify', '--agents-md', '--json'], { cwd: root }],
    ],
  },
];

for (const step of steps) {
  for (const [command, args, opts] of step.commands) {
    const result = spawnSync(command, args, {
      cwd: opts?.cwd,
      stdio: 'inherit',
      shell: false,
      encoding: 'utf8',
    });

    if (result.error) {
      console.error(`[FAILED] ${step.title}: ${result.error.message}`);
      process.exit(1);
    }

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

console.log('post-merge health check passed.');
