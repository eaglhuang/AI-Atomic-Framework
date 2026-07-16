import { type ChildProcess, spawn } from 'node:child_process';
import type { CommandResult } from './types.ts';

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function startCommand(command: string): ChildProcess & { command: string } {
  const startedAt = Date.now();
  const processInstance = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcess & { command: string };
  processInstance.command = command;
  (processInstance as ChildProcess & { startedAtMs?: number }).startedAtMs = startedAt;
  return processInstance;
}

export function promisifyCommand(processInstance: ChildProcess & { command: string }): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    if (processInstance.stdout) {
      processInstance.stdout.setEncoding('utf8');
      processInstance.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (processInstance.stderr) {
      processInstance.stderr.setEncoding('utf8');
      processInstance.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    processInstance.once('error', (error) => {
      const startedAtMs = (processInstance as ChildProcess & { startedAtMs?: number }).startedAtMs;
      const durationMs = typeof startedAtMs === 'number' ? Date.now() - startedAtMs : 0;
      resolve({
        command: processInstance.command,
        exitCode: 1,
        signal: 'error',
        stdout,
        stderr: `${String(error.message)}${stderr ? `\n${stderr}` : ''}`,
        durationMs
      });
    });

    processInstance.once('close', (code, signal) => {
      const startedAtMs = (processInstance as ChildProcess & { startedAtMs?: number }).startedAtMs;
      const durationMs = typeof startedAtMs === 'number' ? Date.now() - startedAtMs : 0;
      resolve({
        command: processInstance.command,
        exitCode: typeof code === 'number' ? code : 0,
        signal: signal ?? null,
        stdout,
        stderr,
        durationMs
      });
    });
  });
}

export async function runCommands(commandList: string[]): Promise<CommandResult[]> {
  if (commandList.length === 0) {
    return [];
  }
  const processes = commandList.map((command) => startCommand(command));
  const results = await Promise.all(processes.map((processInstance) => promisifyCommand(processInstance)));
  return results;
}

export function buildCommandDigest(results: CommandResult[]): string {
  if (results.length === 0) {
    return 'none';
  }
  return results
    .map((result) => `${result.command} => ${result.exitCode}`)
    .join('; ');
}


