import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import fs, { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { projectHostContent, validateHostCloseProjections, prepareHostCloseProjections, applyHostCloseProjections, type HostCloseProjection } from '../../packages/cli/src/commands/taskflow/host-close-projection.ts';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';
import { makeCloseAtomicityFixture, withLaneCapability } from '../../packages/cli/src/commands/taskflow/__tests__/taskflow-close-atomicity.test.ts';

const values = { taskId: 'EXACT', actorId: 'tester', status: 'done', completedAt: '2026-10-17T00:00:00.000Z' };
const config: HostCloseProjection = { kind: 'json', file: 'tasks.json', array: ['tasks'], idField: 'id', fields: { status: { source: 'status' }, completed_at: { source: 'completedAt' } }, summary: { path: ['summary'], totalField: 'total', statusField: 'status', buckets: { done: ['done', 'completed', 'closed'], running: ['in-progress', 'in_progress', 'in progress'], open: [] }, fallbackBucket: 'open' } };
validateHostCloseProjections([config]);
const original = '{\r\n "tasks": [{"id":"EXACT","status":"in-progress","completed_at":"", "未知":"\\\"繁中\\\\字"}, {"id":"EXACT-other","status":"blocked","number":1e2}],\r\n "summary":{"total":9,"done":0,"running":9,"open":0}, "spelling":1.00\r\n}\r\n';
const projected = projectHostContent(original, config, values);
assert.deepEqual(JSON.parse(projected).summary, { total: 2, done: 1, running: 0, open: 1 });
assert.ok(projected.includes('"number":1e2') && projected.includes('"spelling":1.00') && projected.includes('\r\n'));
assert.equal(projectHostContent(projected, config, values), projected);
for (const bad of [original.replace('"EXACT"', '"missing"'), original.replace('"EXACT-other"', '"EXACT"'), '{bad}', original.replace('"spelling":1.00', '"spelling":1.00,"spelling":2')]) assert.throws(() => projectHostContent(bad, config, values));
for (const bad of [{ ...config, file: '../escape' }, { ...config, fields: { id: { value: 'changed' } } }, { ...config, arbitrary: true }, { ...config, kind: 'unknown' }, { ...config, summary: { ...config.summary, buckets: { a: ['same'], b: ['same'] }, fallbackBucket: 'a' } }]) assert.throws(() => validateHostCloseProjections([bad]));
const markdown: HostCloseProjection = { kind: 'markdown', file: 'card.md', section: '## 基本資訊', headers: ['欄位', '值'], labelColumn: '欄位', valueColumn: '值', rows: { 狀態: { value: '完成' } } };
const md = '# 題\r\n## 基本資訊\r\n| 欄位 | 值 |\r\n| --- | --- |\r\n| 狀態 | 進行中 |\r\n## 其他\r\n保留\r\n';
assert.equal(projectHostContent(md, markdown, values), md.replace('進行中', '完成'));
assert.throws(() => projectHostContent(md + md, markdown, values));
assert.throws(() => projectHostContent(md.replace('## 其他', '| 狀態 | 重複 |\r\n## 其他'), markdown, values));

function git(root: string, ...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }); }
async function close(f: Awaited<ReturnType<typeof makeCloseAtomicityFixture>>, write = true) {
  return await withLaneCapability(f.laneSessionId, () => runTaskflow(['close', '--cwd', f.targetRepo, '--profile', f.profilePath, '--task', f.taskId, '--actor', 'validator', ...(write ? ['--write'] : []), '--json'])) as any;
}
const fixtures: Awaited<ReturnType<typeof makeCloseAtomicityFixture>>[] = [];
try {
  for (const [targetOwned, sameRepo] of [[false, false], [true, false], [false, true]]) {
    const f = await makeCloseAtomicityFixture(sameRepo ? 'sameprojection' : targetOwned ? 'targetprojection' : 'projection', true, targetOwned, sameRepo); fixtures.push(f);
    const jsonPath = path.join(f.targetRepo, 'host/tasks.json'); const mdPath = path.join(f.targetRepo, f.hostMarkdown);
    if (!targetOwned && !sameRepo) { git(f.targetRepo, 'update-index', '--chmod=+x', '--', f.hostMarkdown); git(f.targetRepo, 'commit', '-m', 'fixture executable Markdown mode'); }
    const initialMode = git(f.targetRepo, 'ls-tree', 'HEAD', '--', f.hostMarkdown).split(' ')[0];
    const initialHead = git(f.targetRepo, 'rev-parse', 'HEAD').trim();
    const before = readFileSync(jsonPath, 'utf8'); const planningBefore = readFileSync(f.planPath); const planningHead = git(f.planningRepo, 'rev-parse', 'HEAD');
    const retainedTime = '2026-06-01T02:03:04.000Z';
    const ledgerPath = path.join(f.targetRepo, '.atm/history/tasks', f.taskId + '.json');
    if (targetOwned) { const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); ledger.completed_at = retainedTime; writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n'); writeFileSync(f.planPath, readFileSync(f.planPath, 'utf8').replace('status: running', 'status: running\ncompleted_at: 2025-01-01T00:00:00.000Z')); }
    else writeFileSync(f.planPath, readFileSync(f.planPath, 'utf8').replace('status: running', 'status: running\ncompleted_at: ' + retainedTime));
    const expectedPlanning = readFileSync(f.planPath);
    const indexBefore = git(f.targetRepo, 'ls-files', '-s');
    const preview = await close(f, false);
    assert.equal(readFileSync(jsonPath, 'utf8'), before, 'dry run must not mutate');
    assert.equal(git(f.targetRepo, 'ls-files', '-s'), indexBefore, 'dry run must not stage');
    assert.equal(preview.evidence.hostProjections.length, 2);
    // Unrelated staged and unstaged hunks in a selected host file must never enter the close commit.
    writeFileSync(mdPath, readFileSync(mdPath, 'utf8').replace('unrelated original', 'unrelated staged'));
    git(f.targetRepo, 'add', '--', f.hostMarkdown);
    writeFileSync(mdPath, readFileSync(mdPath, 'utf8').replace('unrelated staged', 'unrelated unstaged'));
    const result = await close(f);
    assert.equal(result.ok, true, JSON.stringify(result.messages));
    assert.equal(git(f.targetRepo, 'rev-list', '--count', initialHead + '..HEAD').trim(), '2', 'normal close must create exactly source and closure commits');
    assert.match(git(f.targetRepo, 'show', `HEAD~1:${f.hostMarkdown}`), /unrelated original/, 'source delivery must exclude prior staged/unstaged host edits');
    const committed = git(f.targetRepo, 'show', 'HEAD:host/tasks.json');
    assert.equal(git(f.targetRepo, 'ls-tree', 'HEAD', '--', f.hostMarkdown).split(' ')[0], initialMode, 'close must preserve original tracked file mode');
    assert.deepEqual(JSON.parse(committed).summary, { total: 2, done: 1, in_progress: 0, open: 1 });
    assert.match(git(f.targetRepo, 'show', `HEAD:${f.hostMarkdown}`), /\| Status \| done \|/);
    assert.match(git(f.targetRepo, 'show', `HEAD:${f.hostMarkdown}`), /unrelated original/);
    assert.match(readFileSync(mdPath, 'utf8'), /unrelated unstaged/);
    assert.match(git(f.targetRepo, 'show', `:${f.hostMarkdown}`), /unrelated staged/, 'success must retain selected-file staged hunk');
    assert.match(git(f.targetRepo, 'show', `:${f.hostMarkdown}`), /\| Status \| done \|/);
    assert.equal(JSON.parse(committed).tasks[0].completed_at, retainedTime, 'valid original completion timestamp must survive close');
    assert.equal(JSON.parse(committed).tasks[0].completed_at, result.evidence.hostProjections[0].after && JSON.parse(result.evidence.hostProjections[0].after).tasks[0].completed_at);
    if (sameRepo) { assert.match(git(f.targetRepo, 'show', `HEAD:${f.hostMarkdown}`), /^status: done$/m); assert.match(git(f.targetRepo, 'show', `:${f.hostMarkdown}`), /^status: done$/m, 'staged planning frontmatter must not regress'); }
    if (targetOwned) { assert.deepEqual(readFileSync(f.planPath), expectedPlanning); assert.equal(git(f.planningRepo, 'rev-parse', 'HEAD'), planningHead); assert.equal(git(f.planningRepo, 'status', '--porcelain'), ' M docs/tasks/' + f.taskId + '.task.md\n', 'external pre-existing dirt must remain unchanged'); }
    else assert.match(readFileSync(f.planPath, 'utf8'), /status: done/);
    if (!sameRepo) assert.equal(git(f.planningRepo, 'ls-tree', '--name-only', 'HEAD', '--', 'host/'), '', 'target host projections must never be copied into the external planning repo');
    const repeated = await close(f, false);
    assert.equal(JSON.parse(repeated.evidence.hostProjections[0].after).tasks[0].completed_at, retainedTime, 'repeated close preview must reuse completion time');
  }
  const rosterFixture = await makeCloseAtomicityFixture('rosterfault', true, false); fixtures.push(rosterFixture);
  const rosterPath = path.join(rosterFixture.planningRepo, 'docs/tasks/README.md');
  const rosterProfile = JSON.parse(readFileSync(rosterFixture.profilePath, 'utf8'));
  rosterProfile.delegation.policy.rosterSyncPolicy = 'inline'; rosterProfile.delegation.policy.rosterSync = { indexPath: 'docs/tasks/README.md' };
  writeFileSync(rosterFixture.profilePath, JSON.stringify(rosterProfile, null, 2));
  writeFileSync(rosterPath, '| Task ID | Status | Owner |\n| --- | --- | --- |\n| ' + rosterFixture.taskId + ' | running | validator |\n');
  git(rosterFixture.planningRepo, 'add', '--', 'taskflow.profile.json', 'docs/tasks/README.md'); git(rosterFixture.planningRepo, 'commit', '-m', 'fixture inline roster');
  const rosterBefore = readFileSync(rosterPath); const rosterPlanningBefore = readFileSync(rosterFixture.planPath);
  const rosterJson = path.join(rosterFixture.targetRepo, 'host/tasks.json'); const rosterMd = path.join(rosterFixture.targetRepo, 'host/card.md');
  const rosterJsonBefore = readFileSync(rosterJson); const rosterMdBefore = readFileSync(rosterMd); const rosterWrite = fs.writeFileSync; let rosterInjected = false;
  fs.writeFileSync = ((file: any, ...args: any[]) => {
    const result = (rosterWrite as any)(file, ...args);
    if (!rosterInjected && path.resolve(String(file)) === rosterPath) { rosterInjected = true; throw new Error('roster fixture after-write fault'); }
    return result;
  }) as typeof fs.writeFileSync; syncBuiltinESMExports();
  try { await assert.rejects(() => close(rosterFixture), /roster fixture after-write fault/); }
  finally { fs.writeFileSync = rosterWrite; syncBuiltinESMExports(); }
  assert(rosterInjected, 'must fail after the real inline roster write');
  assert.deepEqual(readFileSync(rosterPath), rosterBefore); assert.deepEqual(readFileSync(rosterFixture.planPath), rosterPlanningBefore);
  assert.deepEqual(readFileSync(rosterJson), rosterJsonBefore); assert.deepEqual(readFileSync(rosterMd), rosterMdBefore);
  assert.notEqual(JSON.parse(readFileSync(path.join(rosterFixture.targetRepo, '.atm/history/tasks', rosterFixture.taskId + '.json'), 'utf8')).status, 'done');
  // Fail actual writes after the ledger transition, and after the first projection write.
  for (const failFile of ['host/tasks.json', 'host/card.md', 'stage-index']) {
    const failed = await makeCloseAtomicityFixture(failFile === 'stage-index' ? 'stagingfault' : failFile.endsWith('.json') ? 'ledgerfault' : 'projectionfault', true, true); fixtures.push(failed);
    const jsonPath = path.join(failed.targetRepo, 'host/tasks.json'); const mdPath = path.join(failed.targetRepo, 'host/card.md');
    writeFileSync(mdPath, readFileSync(mdPath, 'utf8').replace('unrelated original', 'staged fault hunk')); git(failed.targetRepo, 'add', '--', 'host/card.md');
    writeFileSync(mdPath, readFileSync(mdPath, 'utf8').replace('staged fault hunk', 'unstaged fault hunk'));
    const jsonBefore = readFileSync(jsonPath); const mdBefore = readFileSync(mdPath); const stagedBefore = git(failed.targetRepo, 'show', ':host/card.md');
    const originalWrite = fs.writeFileSync; const originalExec = childProcess.execFileSync; let injected = false;
    fs.writeFileSync = ((file: any, ...args: any[]) => {
      if (!injected && path.resolve(String(file)) === path.resolve(failed.targetRepo, failFile)) { injected = true; throw new Error('projection fixture write fault'); }
      return (originalWrite as any)(file, ...args);
    }) as typeof fs.writeFileSync;
    childProcess.execFileSync = ((command: any, args: any, options: any) => {
      if (failFile === 'stage-index' && !injected && command === 'git' && Array.isArray(args) && args[0] === 'update-index' && args.includes('--cacheinfo') && args.some((v: string) => v.endsWith(',host/tasks.json'))) { injected = true; throw new Error('projection fixture write fault'); }
      return (originalExec as any)(command, args, options);
    }) as typeof childProcess.execFileSync; syncBuiltinESMExports();
    let rejected = false;
    try { const result = await close(failed); rejected = result.ok === false; } catch (error) { assert.match(String(error), /projection fixture write fault/); rejected = true; }
    finally { fs.writeFileSync = originalWrite; childProcess.execFileSync = originalExec; syncBuiltinESMExports(); }
    assert(injected && rejected, 'fixture must reach the intended post-ledger write fault');
    assert.deepEqual(readFileSync(jsonPath), jsonBefore); assert.deepEqual(readFileSync(mdPath), mdBefore);
    assert.equal(git(failed.targetRepo, 'show', ':host/card.md'), stagedBefore, 'fault must restore original staged contents');
    assert.notEqual(JSON.parse(readFileSync(path.join(failed.targetRepo, '.atm/history/tasks', failed.taskId + '.json'), 'utf8')).status, 'done');
  }
  const f = await makeCloseAtomicityFixture('projectionrollback', true, true); fixtures.push(f);
  const file = path.join(f.targetRepo, 'host/card.md'); const aggregate = path.join(f.targetRepo, 'host/tasks.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace('unrelated original', 'staged text')); git(f.targetRepo, 'add', '--', 'host/card.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('staged text', 'unstaged text'));
  const before = readFileSync(file); const jsonBefore = readFileSync(aggregate); const index = git(f.targetRepo, 'ls-files', '-s'); const planningBefore = readFileSync(f.planPath); const planningHead = git(f.planningRepo, 'rev-parse', 'HEAD');
  const hooks = path.join(f.targetRepo, '.githooks'); mkdirSync(hooks);
  writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\ncase "$(git log -1 --pretty=%s)" in\n  *"source bundle"*) exit 1;;\nesac\nexit 0\n'); chmodSync(path.join(hooks, 'pre-commit'), 0o755); git(f.targetRepo, 'config', 'core.hooksPath', '.githooks');
  const result = await close(f);
  assert.equal(result.ok, false);
  assert.deepEqual(readFileSync(file), before); assert.deepEqual(readFileSync(aggregate), jsonBefore);
  assert.equal(git(f.targetRepo, 'ls-files', '-s', '--', 'host/card.md'), index.split('\n').filter(x => x.endsWith('\thost/card.md')).join('\n') + '\n');
  assert.notEqual(JSON.parse(readFileSync(path.join(f.targetRepo, '.atm/history/tasks', f.taskId + '.json'), 'utf8')).status, 'done');
  assert.deepEqual(readFileSync(f.planPath), planningBefore); assert.equal(git(f.planningRepo, 'rev-parse', 'HEAD'), planningHead);
  const profile = JSON.parse(readFileSync(f.profilePath, 'utf8'));
  assert.throws(() => prepareHostCloseProjections({ root: f.targetRepo, configs: profile.hostCloseProjections, values: { ...values, taskId: f.taskId }, allowedFiles: [], baseline: () => '' }));
  const prepared = prepareHostCloseProjections({ root: f.targetRepo, configs: profile.hostCloseProjections, values: { ...values, taskId: f.taskId }, allowedFiles: ['host/tasks.json', 'host/card.md'], baseline: p => git(f.targetRepo, 'show', 'HEAD:' + p) });
  writeFileSync(aggregate, readFileSync(aggregate, 'utf8') + ' ');
  assert.throws(() => applyHostCloseProjections(prepared), /CAS drift/);
  fs.symlinkSync(path.join(f.targetRepo, 'host'), path.join(f.targetRepo, 'alias'), 'junction');
  assert.throws(() => prepareHostCloseProjections({ root: f.targetRepo, configs: [...profile.hostCloseProjections, { ...profile.hostCloseProjections[0], file: 'alias/tasks.json' }], values: { ...values, taskId: f.taskId }, allowedFiles: ['host/tasks.json', 'host/card.md', 'alias/tasks.json'], baseline: p => git(f.targetRepo, 'show', 'HEAD:' + p) }), /aliases another physical path|duplicate canonical/);
  fs.symlinkSync(path.join(f.targetRepo, '.atm/history/tasks'), path.join(f.targetRepo, 'protected-alias'), 'junction');
  assert.throws(() => prepareHostCloseProjections({ root: f.targetRepo, configs: [{ ...profile.hostCloseProjections[0], file: 'protected-alias/' + f.taskId + '.json' }], values, allowedFiles: ['protected-alias/' + f.taskId + '.json'], baseline: () => '' }), /aliases another physical path/);
  fs.symlinkSync(f.planningRepo, path.join(f.targetRepo, 'outside'), 'junction');
  assert.throws(() => prepareHostCloseProjections({ root: f.targetRepo, configs: [{ ...profile.hostCloseProjections[0], file: 'outside/taskflow.profile.json' }], values, allowedFiles: ['outside/taskflow.profile.json'], baseline: () => '' }), /escapes repository/);

} finally { for (const f of fixtures) rmSync(f.tempRoot, { recursive: true, force: true }); }
console.log('[taskflow-host-close-projection] ok');
