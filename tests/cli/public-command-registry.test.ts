import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { publicCliCommandNames, publicCliCommandRunners, runPublicCli } from '../../packages/cli/src/atm-public.ts';

async function invoke(args: string[]) {
  let stdout = '';
  let stderr = '';
  const io = {
    stdout: { write(value: string) { stdout += value; } },
    stderr: { write(value: string) { stderr += value; } }
  } as Parameters<typeof runPublicCli>[1];
  const exitCode = await runPublicCli([...args, '--json'], io);
  return { exitCode, stdout, stderr, result: JSON.parse(stdout || stderr) };
}

test('public version reuses one source observation and preserves drift warnings', async () => {
  const source = readFileSync(new URL('../../packages/cli/src/atm-public.ts', import.meta.url), 'utf8');
  assert.match(source, /const runnerSourceDrift = runnerMode\.sourceDrift;/,
    'version must not independently repeat the source inventory');
  for (const alias of ['--version', '-v']) {
    const { exitCode, stderr, result } = await invoke([alias]);
    assert.equal(exitCode, 0);
    assert.equal(stderr, '');
    assert.equal(result.command, 'version');
    const drift = result.evidence.runnerSourceDrift;
    assert.equal(drift.schemaId, 'atm.runnerSourceDrift.v1');
    assert.deepEqual(drift, result.evidence.runnerMode.sourceDrift);
    const warning = result.messages.find((entry: { code: string }) => entry.code === 'ATM_RUNNER_SOURCE_DRIFT');
    assert.equal(Boolean(warning), drift.syncRequired);
    if (warning) assert.deepEqual(warning.data, drift);
  }
});

test('public help advertises exactly the executable command registry', async () => {
  assert.equal(publicCliCommandNames.length, 24, 'preserve the existing public surface plus project setup and atomize');
  assert.deepEqual([...publicCliCommandNames].sort(), Object.keys(publicCliCommandRunners).sort());
  const { exitCode, result } = await invoke(['--help']);
  assert.equal(exitCode, 0);
  assert.deepEqual(result.evidence.commands.map((entry: { command: string }) => entry.command).sort(), [...publicCliCommandNames].sort());
});

for (const name of publicCliCommandNames) {
  test(`published command ${name} is callable and has working help`, async () => {
    assert.equal(typeof publicCliCommandRunners[name], 'function');
    for (const args of [[name, '--help'], ['help', name]]) {
      const { exitCode, stderr, result } = await invoke(args);
      assert.equal(exitCode, 0);
      assert.equal(stderr, '');
      assert.equal(result.ok, true);
    }
  });
}

for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__', 'not-an-atm-command']) {
  for (const args of [[name], [name, '--help'], ['help', name]]) {
    test(`reject non-command ${args.join(' ')}`, async () => {
      const { exitCode, stdout, result } = await invoke(args);
      assert.notEqual(exitCode, 0);
      assert.equal(stdout, '');
      assert.equal(result.ok, false);
      assert.ok(result.messages.some((entry: { code: string }) => entry.code === 'ATM_CLI_UNKNOWN_COMMAND'));
      assert.ok(!result.messages.some((entry: { code: string }) => entry.code === 'ATM_CLI_UNHANDLED'));
    });
  }
}
