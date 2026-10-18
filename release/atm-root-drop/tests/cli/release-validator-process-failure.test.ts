import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Execute the actual subprocess wrapper without triggering the full release
// build or modifying shared outputs. Only spawnSync is replaced by a fixture.
for (const [file, name, args] of [
  ['validate-onefile-release.ts', 'runOnefile', ['atm.mjs', '.', []]],
  ['validate-root-drop-release.ts', 'runAtm', ['.', []]]
] as const) {
  const source = readFileSync(new URL(`../../scripts/${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `${file} must expose the wrapper under test`);
  const javascript = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  for (const [label, status, signal, error, expected] of [
    ['success', 0, null, undefined, 0],
    ['failure', 2, null, undefined, 2],
    ['terminated', null, 'SIGTERM', undefined, 1],
    ['timeout', null, 'SIGTERM', new Error('ETIMEDOUT'), 1],
    ['spawn-error', null, null, new Error('ENOENT'), 1],
    ['missing-status', null, null, undefined, 1]
  ] as const) {
    const mockSpawn = () => ({ status, signal, error, stdout: '{"ok":true}', stderr: '' });
    const wrapper = new Function('spawnSync', 'path', 'process', `${javascript}; return ${name};`)(mockSpawn, path, process);
    const result = wrapper(...args);
    assert.equal(result.exitCode, expected, `${file}: ${label} must not become a false pass`);
    assert.deepEqual(result.parsed, { ok: true }, 'valid output alone cannot prove process success');
  }
}
console.log('[release-validator-process-failure.test] ok');
