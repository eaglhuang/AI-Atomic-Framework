import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireLock, ensureLayout, resolveLayout } from '../layout.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atm-mailbox-layout-'));
try {
  const agents = [{ id: '001', model: 'gpt-test' }];
  const layout = resolveLayout(root, agents);
  ensureLayout(layout);
  ensureLayout(layout); // idempotent
  const release = acquireLock(layout);
  assert.equal(typeof release, 'function');
  release();
  console.log('layout.spec.ts: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
