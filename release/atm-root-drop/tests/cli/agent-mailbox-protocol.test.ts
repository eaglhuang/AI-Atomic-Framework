import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acknowledgeMessage,
  deliverMessage,
  listInbox,
  registerMailbox,
  resolveMailbox
} from '../../scripts/agent-mailbox.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-agent-mailbox-'));

try {
  const codex = registerMailbox({ root, host: 'local', editor: 'codex', session: 'review-1' });
  const cursor = registerMailbox({ root, host: 'local', editor: 'cursor', session: 'implementation-1' });

  assert.notEqual(codex.address, cursor.address);
  assert.equal(existsSync(codex.inboxPath), true);
  assert.equal(existsSync(cursor.inboxPath), true);
  assert.equal(resolveMailbox(root, cursor.address).inboxPath, cursor.inboxPath);

  writeFileSync(path.join(cursor.inboxPath, '.partial-unpublished.md'), 'not published', 'utf8');
  assert.deepEqual(listInbox(cursor), []);

  const delivery = deliverMessage({
    from: codex.address,
    to: cursor,
    id: 'message-001',
    body: 'Please review the protocol boundary.',
    taskId: 'TASK-MBX-0001',
    scope: ['scripts/agent-mailbox.ts'],
    evidence: ['tests/cli/agent-mailbox-protocol.test.ts'],
    command: 'git commit --all' as never
  });

  assert.equal(existsSync(delivery.path), true);
  assert.deepEqual(listInbox(cursor).map((message) => message.id), ['message-001']);
  const rendered = readFileSync(delivery.path, 'utf8');
  assert.match(rendered, /taskId: "TASK-MBX-0001"/);
  assert.doesNotMatch(rendered, /git commit|command:/);

  assert.equal(acknowledgeMessage(cursor, 'message-001').status, 'acknowledged');
  assert.deepEqual(listInbox(cursor), []);
  assert.equal(acknowledgeMessage(cursor, 'message-001').status, 'already-acknowledged');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('[agent-mailbox-protocol:test] ok (5 acceptance checks)');
