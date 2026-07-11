import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import type { AgentLayout, AgentRef, MailboxLayout } from './types.ts';
import { LOCK_STALE_MS } from './constants.ts';

export function requireAgentLayout(layout: MailboxLayout, agentId: string): AgentLayout {
  const agentLayout = layout.agents.get(agentId);
  if (!agentLayout) {
    throw new Error(`Unknown agent layout: ${agentId}`);
  }
  return agentLayout;
}

export function resolveLayout(root: string, agents: AgentRef[]): MailboxLayout {
  const captain = {
    root: path.join(root, 'captain'),
    inbox: path.join(root, 'captain', 'inbox'),
    outbox: path.join(root, 'captain', 'outbox'),
    reports: path.join(root, 'captain', 'reports'),
    queue: path.join(root, 'captain', 'work-queue'),
    archive: path.join(root, 'captain', 'archive'),
    handoff: path.join(root, 'captain', 'handoff'),
    stopLoss: path.join(root, 'captain', 'stop-loss')
  };
  const agentLayouts = new Map(agents.map((agent) => [
    agent.id,
    {
      root: path.join(root, 'agents', agent.id),
      inbox: path.join(root, 'agents', agent.id, 'inbox'),
      active: path.join(root, 'agents', agent.id, 'active'),
      done: path.join(root, 'agents', agent.id, 'done'),
      reports: path.join(root, 'agents', agent.id, 'reports'),
      handoff: path.join(root, 'agents', agent.id, 'handoff'),
      stopLoss: path.join(root, 'agents', agent.id, 'stop-loss')
    }
  ]));

  return {
    root,
    state: path.join(root, 'state'),
    ledger: path.join(root, 'state', 'ledger.json'),
    lock: path.join(root, '.cycle.lock'),
    captain,
    agents: agentLayouts
  };
}

export function ensureLayout(layout: MailboxLayout): void {
  const dirs = [
    layout.root,
    layout.state,
    layout.captain.root,
    layout.captain.inbox,
    layout.captain.outbox,
    layout.captain.reports,
    layout.captain.queue,
    layout.captain.archive,
    layout.captain.handoff,
    layout.captain.stopLoss
  ];
  for (const agentLayout of layout.agents.values()) {
    dirs.push(
      agentLayout.root,
      agentLayout.inbox,
      agentLayout.active,
      agentLayout.done,
      agentLayout.reports,
      agentLayout.handoff,
      agentLayout.stopLoss
    );
  }
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

export function acquireLock(layout: MailboxLayout): () => void {
  mkdirSync(layout.root, { recursive: true });

  if (existsSync(layout.lock)) {
    const ageMs = Date.now() - statSync(layout.lock).mtimeMs;
    if (ageMs > LOCK_STALE_MS) {
      unlinkSync(layout.lock);
    }
  }

  let fd;
  try {
    fd = openSync(layout.lock, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2));
    closeSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      closeSync(fd);
    }
    throw new Error(`Mailbox cycle already has an active lock: ${layout.lock}`);
  }

  return () => {
    if (existsSync(layout.lock)) {
      unlinkSync(layout.lock);
    }
  };
}
