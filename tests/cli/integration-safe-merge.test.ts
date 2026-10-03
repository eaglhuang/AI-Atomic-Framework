import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticIntegrationAdapter } from '../../packages/integrations-core/src/index.ts';
import { readManagedBlocks } from '../../packages/integrations-core/src/manifest/safe-install.ts';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-safe-merge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = { repositoryRoot: root, manifestPath: '.atm/integrations/antigravity.manifest.json', merge: true };
  const adapter = (content = 'ATM entry\n', file = 'GEMINI.md') => createStaticIntegrationAdapter({
    id: 'antigravity', displayName: 'fixture', adapterVersion: '1', targetDir: '.',
    fileFormat: 'markdown', placeholderStyle: 'none', sourceFiles: [{ relativePath: file, content }]
  });
  return { root, context, adapter };
}

test('merge preserves arbitrary user bytes; rerun and remove preserve them exactly', async t => {
  const f = fixture(t); const file = path.join(f.root, 'GEMINI.md');
  const original = '# User instructions\r\nKeep this text without a final newline';
  writeFileSync(file, original);
  const first = await f.adapter().install(f.context);
  assert.equal((await f.adapter().verify(f.context, first.manifest)).ok, true);
  const bytes = readFileSync(file); const manifest = readFileSync(path.join(f.root, f.context.manifestPath));
  const repeat = await f.adapter().install(f.context);
  assert.deepEqual(repeat.writtenFiles, []);
  assert.deepEqual(readFileSync(file), bytes);
  assert.deepEqual(readFileSync(path.join(f.root, f.context.manifestPath)), manifest);
  await f.adapter().uninstall(f.context, repeat.manifest);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('user edits outside managed block do not invalidate owned-content verification', async t => {
  const f = fixture(t); const file = path.join(f.root, 'GEMINI.md'); writeFileSync(file, 'User');
  const report = await f.adapter().install(f.context);
  writeFileSync(file, `More user content\n${readFileSync(file, 'utf8')}`);
  assert.equal((await f.adapter().verify(f.context, report.manifest)).ok, true);
  await f.adapter().uninstall(f.context, report.manifest);
  assert.equal(readFileSync(file, 'utf8'), 'More user content\nUser');
});

test('edited managed block refuses reinstall and is preserved on removal', async t => {
  const f = fixture(t); const file = path.join(f.root, 'GEMINI.md'); writeFileSync(file, 'User');
  const report = await f.adapter().install(f.context);
  writeFileSync(file, readFileSync(file, 'utf8').replace('ATM entry', 'User edited entry'));
  const expected = readFileSync(file);
  assert.throws(() => f.adapter().install(f.context), /MERGE_CONFLICT/);
  assert.equal((await f.adapter().verify(f.context, report.manifest)).ok, false);
  await f.adapter().uninstall(f.context, report.manifest);
  assert.deepEqual(readFileSync(file), expected);
});

test('unmanaged exclusive-file collision fails before writing any projection', t => {
  const f = fixture(t); writeFileSync(path.join(f.root, 'custom.md'), 'user-owned');
  assert.throws(() => f.adapter('ATM content', 'custom.md').install(f.context), /MERGE_CONFLICT/);
  assert.equal(existsSync(path.join(f.root, '.atm')), false);
  assert.equal(readFileSync(path.join(f.root, 'custom.md'), 'utf8'), 'user-owned');
});

test('dry-run previews merge without writing and malformed marker fails closed', async t => {
  const f = fixture(t); const file = path.join(f.root, 'GEMINI.md'); writeFileSync(file, 'User');
  await f.adapter().install({ ...f.context, dryRun: true });
  assert.equal(readFileSync(file, 'utf8'), 'User');
  assert.equal(existsSync(path.join(f.root, '.atm')), false);
  writeFileSync(file, '\n<!-- ATM:antigravity:BEGIN -->\npartial');
  assert.throws(() => f.adapter().install(f.context), /MERGE_CONFLICT/);
});

test('verified managed update is backed up; modified whole file is never reclassified', async t => {
  const f = fixture(t); const file = path.join(f.root, 'GEMINI.md');
  await f.adapter().install(f.context);
  await f.adapter('Next entry\n').install(f.context);
  assert.equal(readFileSync(file, 'utf8'), 'Next entry\n');
  assert.equal(existsSync(path.join(f.root, '.atm/integrations/backups/antigravity')), true);
  writeFileSync(file, 'local edit');
  assert.throws(() => f.adapter('Third entry\n').install(f.context), /MERGE_CONFLICT/);
});

test('symlink destination ancestor cannot write outside selected project', t => {
  const f = fixture(t); const outside = mkdtempSync(path.join(tmpdir(), 'atm-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, path.join(f.root, '.atm'), 'dir');
  assert.throws(() => f.adapter().install(f.context), /UNSAFE_PATH/);
  assert.equal(existsSync(path.join(f.root, 'GEMINI.md')), false);
});

test('a backup path symlink cannot redirect a managed update', async t => {
  const f = fixture(t); await f.adapter().install(f.context);
  const outside = mkdtempSync(path.join(tmpdir(), 'atm-backup-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(path.join(f.root, '.atm/integrations/backups'));
  symlinkSync(outside, path.join(f.root, '.atm/integrations/backups/antigravity'), 'dir');
  assert.throws(() => f.adapter('updated\n').install(f.context), /UNSAFE_PATH/);
  assert.equal(readFileSync(path.join(f.root, 'GEMINI.md'), 'utf8'), 'ATM entry\n');
});

test('non-UTF-8 shared user files are rejected losslessly on merge and removal', async t => {
  const f = fixture(t); const file = path.join(f.root, 'GEMINI.md');
  const invalid = Buffer.from([0xff, 0xfe, 0x41]); writeFileSync(file, invalid);
  assert.throws(() => f.adapter().install(f.context), /ENCODING_CONFLICT/);
  assert.deepEqual(readFileSync(file), invalid);
  writeFileSync(file, 'User'); const report = await f.adapter().install(f.context);
  const corrupted = Buffer.concat([invalid, readFileSync(file)]); writeFileSync(file, corrupted);
  assert.throws(() => f.adapter().uninstall(f.context, report.manifest), /ENCODING_CONFLICT/);
  assert.deepEqual(readFileSync(file), corrupted);
});

test('noncanonical and nonexistent ownership paths are rejected', async t => {
  const f = fixture(t); const result = await f.adapter().install(f.context);
  for (const file of ['./GEMINI.md', 'unknown.md']) {
    assert.throws(() => readManagedBlocks({ ...result.manifest, metadata: { managedBlocks: JSON.stringify({ [file]: 'antigravity' }) } }), /INVALID_OWNERSHIP/);
  }
});

test('invalid peer ownership blocks removal; stale peer hashes still preserve shared files', async t => {
  const f = fixture(t); const result = await f.adapter().install(f.context);
  const peer = path.join(f.root, '.atm/integrations/codex.host.json');
  writeFileSync(peer, JSON.stringify({ schemaId: 'atm.integrationInstallManifest', files: null }));
  assert.throws(() => f.adapter().uninstall(f.context, result.manifest), /INVALID_OWNERSHIP/);
  assert.ok(existsSync(path.join(f.root, 'GEMINI.md')));
  assert.ok(existsSync(path.join(f.root, f.context.manifestPath)));
  writeFileSync(peer, JSON.stringify({ ...result.manifest, adapterId: 'codex', files: result.manifest.files.map(file => ({ ...file, sha256: `sha256:${'0'.repeat(64)}` })) }));
  await f.adapter().uninstall(f.context, result.manifest);
  assert.ok(existsSync(path.join(f.root, 'GEMINI.md')));
});
