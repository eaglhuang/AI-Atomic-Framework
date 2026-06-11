import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const hooksModule = path.join(repoRoot, 'packages/cli/src/commands/integration-hooks.ts');

function runProbe(scriptBody: string, input?: string, env?: NodeJS.ProcessEnv) {
  const wrapped = `
    import { pathToFileURL } from 'node:url';
    const moduleUrl = pathToFileURL(${JSON.stringify(hooksModule)}).href;
    const loaded = await import(moduleUrl);
    ${scriptBody}
  `;
  return spawnSync(process.execPath, ['--strip-types', '-e', wrapped], {
    cwd: repoRoot,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    timeout: 10_000
  });
}

function testIdleStdinReturnsNullQuickly() {
  const result = runProbe(`
    const start = Date.now();
    const value = loaded.readOptionalStdinJson(false);
    const elapsed = Date.now() - start;
    console.log(JSON.stringify({ value, elapsed }));
  `);
  assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
  const payload = JSON.parse(result.stdout.toString().trim());
  assert.equal(payload.value, null);
  assert.ok(payload.elapsed < 500, `idle stdin probe took ${payload.elapsed}ms`);
  console.log('✅ idle inherited stdin returns null quickly');
}

function testPipedJsonStdinParsed() {
  const stdinJson = JSON.stringify({ toolName: 'Edit', prompt: 'hello hook', editor: 'claude-code' });
  const result = runProbe(`
    const value = loaded.readOptionalStdinJson(false);
    console.log(JSON.stringify(value));
  `, stdinJson);
  assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
  const payload = JSON.parse(result.stdout.toString().trim());
  assert.deepEqual(payload, {
    toolName: 'Edit',
    prompt: 'hello hook',
    editor: 'claude-code'
  });
  console.log('✅ piped JSON stdin is parsed');
}

function testNoStdinFlagSkipsPipedPayload() {
  const stdinJson = JSON.stringify({ editor: 'claude-code', prompt: 'from stdin' });
  const result = runProbe(`
    const hookResult = loaded.runIntegrationHookInvocation([
      'pre-tool',
      '--no-stdin',
      '--cwd',
      ${JSON.stringify(repoRoot)},
      '--editor',
      'copilot',
      '--tool-name',
      'Read',
      '--files',
      'README.md'
    ]);
    console.log(JSON.stringify({
      ok: hookResult.ok,
      editor: hookResult.evidence.editor
    }));
  `, stdinJson);
  assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
  const payload = JSON.parse(result.stdout.toString().trim());
  assert.equal(payload.ok, true);
  assert.equal(payload.editor, 'copilot');
  console.log('✅ --no-stdin ignores piped JSON');
}

function testEnvNoStdinSkipsPipedPayload() {
  const stdinJson = JSON.stringify({ editor: 'claude-code' });
  const result = runProbe(`
    const value = loaded.readOptionalStdinJson(false);
    console.log(JSON.stringify(value));
  `, stdinJson, { ATM_HOOK_NO_STDIN: '1' });
  assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
  assert.equal(result.stdout.toString().trim(), 'null');
  console.log('✅ ATM_HOOK_NO_STDIN=1 skips stdin');
}

function testInProcessHelperAddsNoStdin() {
  const stdinJson = JSON.stringify({ editor: 'claude-code' });
  const result = runProbe(`
    const hookResult = loaded.runIntegrationHookInvocationInProcess([
      'pre-tool',
      '--cwd',
      ${JSON.stringify(repoRoot)},
      '--editor',
      'copilot',
      '--tool-name',
      'Read',
      '--files',
      'README.md'
    ]);
    console.log(JSON.stringify({ editor: hookResult.evidence.editor }));
  `, stdinJson);
  assert.equal(result.status, 0, result.stderr?.toString() || result.stdout?.toString());
  const payload = JSON.parse(result.stdout.toString().trim());
  assert.equal(payload.editor, 'copilot');
  console.log('✅ runIntegrationHookInvocationInProcess opts out of stdin');
}

testIdleStdinReturnsNullQuickly();
testPipedJsonStdinParsed();
testNoStdinFlagSkipsPipedPayload();
testEnvNoStdinSkipsPipedPayload();
testInProcessHelperAddsNoStdin();

console.log('[integration-hooks-stdin:test] All tests verified successfully');
