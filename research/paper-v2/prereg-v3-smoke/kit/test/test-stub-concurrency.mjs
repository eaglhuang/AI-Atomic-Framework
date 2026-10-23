/** #367: exercise the actual kit against source broker, without a model or npm CLI. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../../../..');
const kit = path.resolve(import.meta.dirname, '..');
const source = relative => pathToFileURL(path.join(root, relative)).href;
const { runBroker } = await import(source('packages/cli/src/commands/broker.ts'));
const { canonicalCommitLockPath, defaultStewardCommitLockRoot } = await import(source('packages/core/src/broker/steward-commit-guard.ts'));
const { acquireKernelAdvisoryLock } = await import(source('packages/core/src/broker/steward-kernel-lock.ts'));

if (process.env.ATM_SUITE_LOCK_HOLDER) {
  const cwd = process.env.ATM_SUITE_LOCK_HOLDER;
  acquireKernelAdvisoryLock(canonicalCommitLockPath(defaultStewardCommitLockRoot(cwd), path.join(cwd, 'note.txt')), 1000, 5, 'note.txt');
  process.stdout.write('ready\n');
  setInterval(() => {}, 1000);
} else {
  const temp = mkdtempSync(path.join(tmpdir(), 'atm367-'));
  const children = new Set();
  try {
    // The kit pins its CLI protocol to 0.1.22. This TEST-ONLY bridge advertises
    // that protocol while executing this checkout's real runBroker, never a
    // fabricated write result. It does not validate the published npm pin.
    const cli = path.join(temp, 'source-cli.mjs');
    writeFileSync(cli, `import {runBroker} from ${JSON.stringify(source('packages/cli/src/commands/broker.ts'))};
if(process.argv.includes('--version')) console.log(JSON.stringify({evidence:{frameworkVersion:'0.1.22'}}));
else console.log(JSON.stringify(await runBroker(process.argv.slice(3).filter(x=>x!=='--json'))));\n`);
    const bin = path.join(temp, 'bin');
    mkdirSync(bin);
    symlinkSync(path.join(kit, 'bin/atm-write'), path.join(bin, 'atm-write'));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1' };
    for (const key of ['PREREG_STEWARD_SOCK', 'PREREG_SESSION_SLOT', 'PREREG_SESSION_BASE_COMMIT',
      'PREREG_GOLD_PATCH', 'GOLD_ROOT', 'ATM_SUITE_LOCK_HOLDER']) delete env[key];

    function git(cwd, ...args) {
      const r = spawnSync('/usr/bin/git', ['-C', cwd, '-c', 'user.name=fixture', '-c', 'user.email=fixture@localhost',
        '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env, timeout: 10000 });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    }
    function repo(name, text) {
      const cwd = path.join(temp, name);
      mkdirSync(cwd);
      git(cwd, 'init', '-q');
      git(cwd, 'config', 'core.autocrlf', 'false');
      writeFileSync(path.join(cwd, 'note.txt'), text);
      git(cwd, 'add', 'note.txt');
      git(cwd, 'commit', '-qm', 'base');
      mkdirSync(path.join(cwd, '.prereg-smoke'));
      writeFileSync(path.join(cwd, '.prereg-smoke/session-write.json'), JSON.stringify({ writableRoot: cwd, cli, safePath: env.PATH }));
      return { cwd, base: git(cwd, 'rev-parse', 'HEAD'), text };
    }
    const rows = cwd => readFileSync(path.join(cwd, '.prereg-smoke/steward-writes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    function child(command, args, options = {}) {
      const p = spawn(command, args, { env, ...options });
      children.add(p);
      let stdout = '', stderr = '';
      p.stdout.on('data', c => { stdout += c; });
      p.stderr.on('data', c => { stderr += c; });
      const done = new Promise((resolve, reject) => {
        p.on('error', reject);
        p.on('close', (status, signal) => { children.delete(p); resolve({ status, signal, stdout, stderr }); });
      });
      return { p, done, stdout: () => stdout };
    }
    async function waitFor(check, label) {
      const deadline = Date.now() + 10000;
      while (!check()) {
        assert.ok(Date.now() < deadline, `timeout: ${label}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const patch = (n, before, after) => `@@ -${n} +${n} @@\n-${before}\n+${after}\n`;
    function submit(fixture, text, slot, mode, extra = []) {
      const patchFile = path.join(fixture.cwd, `patch-${slot}.diff`);
      writeFileSync(patchFile, text);
      const args = ['note.txt', patchFile, '--actor', 'fake-codex', '--task', `task-${slot}`, ...extra];
      if (mode === 'stub') {
        const baseFile = path.join(fixture.cwd, `base-${slot}.txt`);
        writeFileSync(baseFile, fixture.text);
        args.push('--base-file', baseFile, '--attempt', '99');
      }
      const r = spawnSync('/bin/bash', ['-c', 'atm-write "$1" <(cat "$2") "${@:3}"', 'fake-codex', ...args], {
        cwd: fixture.cwd, env: { ...env, PREREG_SESSION_SLOT: slot, PREREG_SESSION_BASE_COMMIT: fixture.base }, encoding: 'utf8', timeout: 45000
      });
      assert.ok([0, 3].includes(r.status), r.stderr + r.stdout);
      return JSON.parse(r.stdout);
    }

    for (const mode of ['real', 'stub']) {
      console.log(`fake codex ${mode} sessions, retries and stale placement`);
      // Run the EXISTING fake codex concurrently through the real socket steward.
      const f = repo(`sessions-${mode}`, 'ALPHA\nspacer\nBETA\n');
      const sock = path.join(f.cwd, 'steward.sock');
      const daemon = child(process.execPath, [path.join(kit, 'bin/steward-daemon.mjs'), '--sock', sock,
        '--cwd', f.cwd, '--script', path.join(kit, 'bin/atm-write.mjs')]);
      await waitFor(() => existsSync(sock), 'steward socket');
      try {
        const sessions = ['ALPHA', 'BETA'].map((marker, i) => {
          const prompt = path.join(f.cwd, `prompt-${i}.txt`);
          writeFileSync(prompt, `Change the ${marker} marker in note.txt to ${marker}-done.`);
          return child(process.execPath, [path.join(kit, 'bin/stub-codex.mjs'), prompt], {
            cwd: f.cwd, env: { ...env, PREREG_SESSION_DIR: path.join(f.cwd, `session-${i}`), PREREG_WORK: f.cwd,
              PREREG_INSTANCE_ID: `fake-${i}`, PREREG_SESSION_SLOT: String(i + 1), PREREG_ARM: 'B',
              PREREG_SESSION_BASE_COMMIT: f.base, PREREG_STEWARD_SOCK: sock, PREREG_STUB_WRITE_MODE: mode }
          }).done;
        });
        for (const r of await Promise.all(sessions)) {
          assert.equal(r.status, 0, r.stderr + r.stdout);
          const events = r.stdout.trim().split('\n').map(JSON.parse);
          assert.equal(events.find(e => e.type === 'stub.session.completed').usage.total_tokens, 0);
          assert.ok(events.some(e => e.type === 'stub.atm-write' && e.decision === 'accepted'));
        }
        assert.equal(readFileSync(path.join(f.cwd, 'note.txt'), 'utf8'), 'ALPHA-done\nspacer\nBETA-done\n');
        const writes = rows(f.cwd);
        assert.equal(writes.length, 2);
        for (const row of writes) {
          assert.equal(row.decision, 'accepted');
          assert.equal(row.attempt, 1);
          const committed = readFileSync(path.join(f.cwd, '.atm/runtime/live-write-journal.jsonl'), 'utf8')
            .trim().split('\n').map(JSON.parse).find(r => r.kind === 'committed' && r.proposalId === row.proposalId);
          assert.ok(committed?.commitSha);
          assert.equal(git(f.cwd, 'log', '-1', '--format=%s', committed.commitSha), `steward live write ${row.proposalId}`);
        }
      } finally { daemon.p.kill(); await daemon.done; }

      // Actual parser rejection, then corrected intent: the steward counts both
      // submissions even when the legacy stub supplies a bogus --attempt 99.
      const retry = repo(`retry-${mode}`, 'one\ntwo\nthree\n');
      const rejected = submit(retry, patch(2, 'absent', 'TWO'), 'retry', mode);
      const accepted = submit(retry, patch(2, 'two', 'TWO'), 'retry', mode);
      assert.equal(rejected.reasonCode, 'patch-context-mismatch');
      assert.equal(accepted.decision, 'accepted');
      assert.deepEqual(rows(retry.cwd).map(r => [r.attempt, r.retryCount]), [[1, 0], [2, 1]]);
      assert.equal(readFileSync(path.join(retry.cwd, 'note.txt'), 'utf8'), 'one\nTWO\nthree\n');

      // #363 C2: actual atm-write must preserve which repeated b was read.
      const stale = repo(`stale-${mode}`, 'a\nb\nb\nc\n');
      assert.equal(submit(stale, '@@ -0,0 +1 @@\n+Z\n', 'insert', mode).decision, 'accepted');
      const placed = submit(stale, patch(3, 'b', 'B3'), 'stale', mode);
      assert.equal(placed.decision, 'accepted');
      assert.equal(readFileSync(path.join(stale.cwd, 'note.txt'), 'utf8'), 'Z\na\nb\nB3\nc\n');

    }

    // Lock timeout: a live process holds the exact product lock. Do not shorten
    // the production 30s budget or replace the timeout result with a stub.
    console.log('real lock timeout fixture (30s)');
    const locked = repo('lock-timeout', 'seed\n');
    const holder = child(process.execPath, [import.meta.filename], { env: { ...env, ATM_SUITE_LOCK_HOLDER: locked.cwd } });
    await waitFor(() => holder.stdout().includes('ready'), 'held lock');
    try {
      const p = { schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: '' },
        proposalId: 'timeout', taskId: 'timeout', actorId: 'timeout', baseCommit: locked.base,
        fileBeforeHash: `sha256:${(await import('node:crypto')).createHash('sha256').update(locked.text).digest('hex')}`,
        targetFile: 'note.txt', atomRefs: [], anchors: [], intent: 'timeout', patch: patch(1, 'seed', 'next'), validators: [], rollback: 'restore' };
      const file = path.join(locked.cwd, 'proposal.json');
      writeFileSync(file, JSON.stringify(p));
      const result = await runBroker(['steward', 'apply-live', '--cwd', locked.cwd, '--proposal-file', file, '--scope-file', 'note.txt']);
      assert.equal(result.messages[0].code, 'ATM_BROKER_LIVE_WRITE_KIT_ERROR');
      assert.equal(result.evidence.liveWrites[0].reasonCode, 'live-write-lock-timeout');
      assert.equal(readFileSync(path.join(locked.cwd, 'note.txt'), 'utf8'), locked.text);
    } finally { holder.p.kill(); await holder.done; }
    assert.equal(submit(locked, patch(1, 'seed', 'next'), 'after-timeout', 'real').decision, 'accepted');

    // Kill the whole writer process group after the real atomic rename, before
    // git add takes an index lock. The product creates/reconciles its own intent.
    console.log('SIGKILL crash fixture');
    const crash = repo('crash', 'seed\n');
    const crashBin = path.join(temp, 'crash-bin');
    mkdirSync(crashBin);
    writeFileSync(path.join(crashBin, 'git'), '#!/bin/bash\nif [ "${3:-}" = add ] && [ -n "${ATM_CRASH_READY:-}" ]; then\n touch "$ATM_CRASH_READY"\n sleep 60\nfi\nexec /usr/bin/git "$@"\n', { mode: 0o755 });
    const config = path.join(crash.cwd, '.prereg-smoke/session-write.json');
    writeFileSync(config, JSON.stringify({ writableRoot: crash.cwd, cli, safePath: `${crashBin}:${env.PATH}` }));
    const ready = path.join(temp, 'renamed');
    const diff = path.join(temp, 'crash.patch');
    writeFileSync(diff, patch(1, 'seed', 'dangling'));
    const writer = child(process.execPath, [path.join(kit, 'bin/atm-write.mjs'), 'note.txt', diff, '--actor', 'original', '--task', 'original'], {
      cwd: crash.cwd, detached: true, env: { ...env, ATM_CRASH_READY: ready, PREREG_SESSION_BASE_COMMIT: crash.base }
    });
    await waitFor(() => existsSync(ready), 'rename before commit');
    assert.equal(readFileSync(path.join(crash.cwd, 'note.txt'), 'utf8'), 'dangling\n');
    assert.equal(git(crash.cwd, 'rev-parse', 'HEAD'), crash.base);
    process.kill(-writer.p.pid, 'SIGKILL');
    assert.equal((await writer.done).signal, 'SIGKILL');
    const journal = path.join(crash.cwd, '.atm/runtime/live-write-journal.jsonl');
    const intent = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse).find(r => r.kind === 'intent');
    assert.ok(intent && !existsSync(path.join(crash.cwd, '.git/index.lock')));
    writeFileSync(config, JSON.stringify({ writableRoot: crash.cwd, cli, safePath: env.PATH }));
    // A later write invokes recovery before normal validation. The abandoned
    // session's bytes must get its own commit, never the next actor's receipt.
    submit(crash, patch(1, 'seed', 'next'), 'recovery', 'real');
    const recovered = readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse)
      .find(r => r.kind === 'committed' && r.proposalId === intent.proposalId);
    assert.ok(recovered, 'original intent was not recovered');
    assert.equal(git(crash.cwd, 'log', '-1', '--format=%s', recovered.commitSha), `steward live write ${intent.proposalId}`);
    assert.equal(git(crash.cwd, 'show', `${recovered.commitSha}:note.txt`), 'dangling');
    console.log('fake codex real/stub socket parity, steward retries, 30s lock timeout, SIGKILL rename recovery passed');
  } finally {
    for (const p of children) {
      if (p.pid) { try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); } }
    }
    rmSync(temp, { recursive: true, force: true });
  }
}
