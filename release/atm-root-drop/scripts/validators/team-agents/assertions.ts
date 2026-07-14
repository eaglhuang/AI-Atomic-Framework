import assert from 'node:assert/strict';
import { CliError } from '../../../packages/cli/src/commands/shared.ts';

export function fail(message: string): never {
  console.error(`[validate-team-agents] ${message}`);
  process.exit(1);
}

export async function assertRejectsCliError(action: () => Promise<unknown>, code: string): Promise<CliError> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof CliError, `expected CliError ${code}, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected CliError ${code}`);
}
