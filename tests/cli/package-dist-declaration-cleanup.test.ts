import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-declaration-cleanup-'));
try {
  const root = path.join(fixture, 'source');
  const output = path.join(fixture, 'output');
  const pkg = path.join(root, 'packages/starter');
  const types = path.join(root, '.types/packages/starter/src');
  mkdirSync(path.join(pkg, 'src'), { recursive: true });
  mkdirSync(types, { recursive: true });
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'fixture-starter', version: '1.0.0', types: './dist/index.d.ts', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }, files: ['dist'] }));
  writeFileSync(path.join(pkg, 'src/index.ts'), 'export const value = 1;\n');
  writeFileSync(path.join(types, 'index.d.ts'), 'export declare const value = 1;\n');
  mkdirSync(path.join(output, 'packages/starter/dist'), { recursive: true });
  writeFileSync(path.join(output, 'packages/starter/dist/stale.d.ts'), 'export {};\n');
  const build = fileURLToPath(new URL('../../scripts/build-package-dist.ts', import.meta.url));
  execFileSync(process.execPath, ['--strip-types', build, '--repository-root', root, '--output-root', output, '--package', 'starter'], { stdio: 'pipe' });
  const dist = path.join(output, 'packages/starter/dist');
  assert.equal(existsSync(path.join(dist, 'index.d.ts')), true, 'declared declaration survives cleanup');
  assert.equal(readFileSync(path.join(dist, 'index.d.ts'), 'utf8'), 'export declare const value = 1;\n');
  assert.equal(existsSync(path.join(dist, 'stale.d.ts')), false, 'obsolete declaration is removed');
  assert.equal(existsSync(path.join(dist, 'index.js')), true);
  const packedRoot = path.dirname(dist);
  copyFileSync(path.join(pkg, 'package.json'), path.join(packedRoot, 'package.json'));
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  assert.ok(existsSync(npmCli), 'installed npm CLI entrypoint exists');
  const pack = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', fixture], { cwd: packedRoot, encoding: 'utf8' }));
  assert.ok(pack[0].files.some((file: { path: string }) => file.path === 'dist/index.d.ts'), 'archive contains declared type entrypoint');
  assert.ok(!pack[0].files.some((file: { path: string }) => file.path === 'dist/stale.d.ts'));
  rmSync(types, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
  execFileSync(process.execPath, ['--strip-types', build, '--repository-root', root, '--output-root', output, '--package', 'starter'], { stdio: 'pipe' });
  const freshDeclaration = readFileSync(path.join(dist, 'index.d.ts'), 'utf8');
  assert.match(freshDeclaration, /export declare const value = 1/);
  assert.ok(!freshDeclaration.includes('../src/'), 'fresh builds do not export unshipped source');
  writeFileSync(path.join(pkg, 'src/index.ts'), "export { value } from './value.ts';\n");
  writeFileSync(path.join(pkg, 'src/value.ts'), 'export const value = 2;\n');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    execFileSync(process.execPath, ['--strip-types', build, '--repository-root', root, '--output-root', output, '--package', 'starter'], { stdio: 'pipe' });
    assert.match(readFileSync(path.join(dist, 'index.d.ts'), 'utf8'), /from ['"]\.\/value\.js['"]/);
    assert.match(readFileSync(path.join(dist, 'value.d.ts'), 'utf8'), /export declare const value = 2/);
  }
  const consumer = path.join(packedRoot, 'consumer.ts');
  writeFileSync(consumer, "import { value } from './dist/index.js';\nconst checked: 2 = value;\nexport { checked };\n");
  const program = ts.createProgram([consumer], { noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), [], 'consumer resolves emitted declaration closure');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log('[package-dist-declaration-cleanup] passed');
