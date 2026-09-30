import assert from 'node:assert/strict';
import { encodeCommandSpecModule } from '../../scripts/lib/cli-npm-command-spec-codec.ts';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCliNpmRuntime } from '../../scripts/build-cli-npm-runtime.ts';

async function decode(specs: Readonly<Record<string, unknown>>) {
  return import(`data:text/javascript;base64,${Buffer.from(encodeCommandSpecModule(specs)).toString('base64')}`);
}
const shared = { flag: '--cwd', optional: undefined };
const sparse = new Array(3);
sparse[1] = shared;
const actor = Object.freeze({ name: 'actor', visibility: 'public', options: [shared, sparse] });
const team = Object.freeze({ name: 'team', visibility: 'internal', options: [shared] });
const specs = Object.freeze({ actor, team });
const runtime = await decode(specs);
assert.deepEqual(runtime.commandSpecs, specs);
assert(Object.isFrozen(runtime.commandSpecs));
assert(Object.isFrozen(runtime.getCommandSpec('actor')));
assert.equal(runtime.getCommandSpec('actor').options[0], runtime.getCommandSpec('team').options[0]);
assert.equal(runtime.getCommandSpec('actor').options[1][1], runtime.getCommandSpec('team').options[0]);
assert.equal(0 in runtime.getCommandSpec('actor').options[1], false);
assert.equal(runtime.getCommandSpec('missing'), null);
assert.deepEqual(runtime.listCommandSpecs().map((spec: { name: string }) => spec.name), ['actor']);
assert.deepEqual(runtime.listCommandSpecs({ includeInternal: true }).map((spec: { name: string }) => spec.name), ['actor', 'team']);
assert.deepEqual(Object.getOwnPropertyDescriptors(runtime.commandSpecs), Object.getOwnPropertyDescriptors(specs));
assert.throws(() => { runtime.getCommandSpec('actor').name = 'changed'; }, TypeError);
runtime.getCommandSpec('team').options[0].flag = '--repository';
assert.equal(runtime.getCommandSpec('actor').options[0].flag, '--repository');

const cycle: Record<string, unknown> = Object.create(null);
cycle.self = cycle;
Object.defineProperty(cycle, '__proto__', { value: shared, enumerable: true });
Object.preventExtensions(cycle);
const cyclicRuntime = await decode({ cycle });
assert.equal(cyclicRuntime.commandSpecs.cycle.self, cyclicRuntime.commandSpecs.cycle);
assert.equal(Object.getPrototypeOf(cyclicRuntime.commandSpecs.cycle), null);
assert.equal(Object.isExtensible(cyclicRuntime.commandSpecs.cycle), false);
assert.deepEqual(Object.getOwnPropertyDescriptor(cyclicRuntime.commandSpecs.cycle, '__proto__'), Object.getOwnPropertyDescriptor(cycle, '__proto__'));
for (const value of [() => null, Symbol('spec'), NaN, Infinity, -0, new Date()]) {
  assert.throws(() => encodeCommandSpecModule({ value }), TypeError);
}
assert.throws(() => encodeCommandSpecModule({ get value() { throw new Error('Accessor must not execute'); } }), /accessors/);

// Exercise the real esbuild plugin through an operation-owned fixture.
const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-spec-codec-'));
try {
  const cli = path.join(fixture, 'packages/cli');
  mkdirSync(path.join(cli, 'dist/commands'), { recursive: true });
  mkdirSync(path.join(cli, 'src'), { recursive: true });
  writeFileSync(path.join(cli, 'src/index.ts'), 'export const fixtureMarker = true;\n');
  writeFileSync(path.join(cli, 'dist/index.js'), "export { commandSpecs, getCommandSpec, listCommandSpecs } from './commands/command-specs.js';\n");
  writeFileSync(path.join(cli, 'dist/atm-public.js'), 'export const publicCliCommandNames = ["actor", "team"]; export const runPublicCli = () => 0;\n');
  writeFileSync(path.join(cli, 'dist/commands/command-specs.js'), `
const shared = { flag: '--cwd', help: undefined };
export const commandSpecs = Object.freeze({ actor: Object.freeze({ name: 'actor', visibility: 'public', options: [shared] }), team: Object.freeze({ name: 'team', visibility: 'internal', options: [shared] }) });
export function getCommandSpec(name) { return name in commandSpecs ? commandSpecs[name] : null; }
export function listCommandSpecs(options = {}) { return Object.values(commandSpecs).filter(spec => options.includeInternal || spec.visibility !== 'internal'); }
`);
  const manifest = await buildCliNpmRuntime({ repositoryRoot: fixture });
  const built = await import(pathToFileURL(path.join(cli, 'dist/npm-runtime/runtime.mjs')).href);
  assert.equal(built.getCommandSpec('actor').options[0], built.getCommandSpec('team').options[0]);
  assert(Object.isFrozen(built.commandSpecs));
  assert(Object.hasOwn(built.getCommandSpec('actor').options[0], 'help'));
  assert.equal(built.getCommandSpec('actor').options[0].help, undefined);
  assert.deepEqual(built.listCommandSpecs().map((spec: { name: string }) => spec.name), ['actor']);
  assert.equal(manifest.entrypoints.runtime, 'runtime.mjs');
  assert(readFileSync(path.join(cli, 'dist/npm-runtime/runtime.mjs'), 'utf8').includes('node:zlib'));
  assert.equal(readFileSync(path.join(cli, 'dist/commands/command-specs.js'), 'utf8').includes('gunzipSync'), false);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log('cli-npm-command-spec-codec: passed');
