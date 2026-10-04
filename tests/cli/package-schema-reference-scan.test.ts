import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

// Extract the real collector without executing the package builder or touching dist.
const source = readFileSync(new URL('../../scripts/build-package-dist.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('build-package-dist.ts', source, ts.ScriptTarget.Latest, true);
const collector = parsed.statements.find((node) => ts.isFunctionDeclaration(node)
  && node.name?.text === 'collectReferencedSchemaAssets');
assert.ok(collector);
const js = ts.transpileModule(collector.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-schema-reference-'));
const files: string[] = [];
const put = (name: string, body: string) => {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, 'utf8');
  if (name.startsWith('packages/')) files.push(file);
};
try {
  put('schemas/real.schema.json', '{}');
  put('schemas/shipped.schema.json', '{}');
  put('packages/example/src/runtime.ts', `
    // schemas/comment-only.schema.json
    /* resolveShippedSchemaPath(import.meta.url, 'comment-call.schema.json') */
    const real = 'schemas/real.schema.json';
    const shipped = resolveShippedSchemaPath(import.meta.url, 'shipped.schema.json');
  `);
  put('packages/example/src/__tests__/fixture.ts', "const x = 'schemas/test-only.schema.json';");
  const collect = new Function('listFiles', 'root', 'readFileSync', 'existsSync', 'path',
    'embeddedATMChartSchemaAssets', 'ts', `${js}\nreturn collectReferencedSchemaAssets;`)(
    () => files, root, readFileSync, existsSync, path, {}, ts) as () => string[];
  assert.deepEqual(collect(), ['schemas/real.schema.json', 'schemas/shipped.schema.json']);
  put('packages/example/src/missing.ts', "const missing = 'schemas/missing.schema.json';");
  assert.throws(collect, /Runtime code names schemas that do not exist: schemas\/missing\.schema\.json/);
  console.log('[package-schema-reference-scan.test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
