import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Ledger, MailboxLayout, MailboxOptions } from './types.ts';
import { createStopLossState, normalizeStopLoss } from './stop-loss.ts';

export function readLedger(layout: MailboxLayout, options: MailboxOptions): Ledger {
  if (!existsSync(layout.ledger)) {
    return createLedger(options);
  }
  const parsed = JSON.parse(readFileSync(layout.ledger, 'utf8'));
  return {
    schemaVersion: 1,
    captain: { id: 'captain', model: options.captainModel, ...(parsed.captain || {}) },
    agents: options.agents,
    dispatches: parsed.dispatches || {},
    stopLoss: normalizeStopLoss(parsed.stopLoss, options)
  };
}

export function createLedger(options: MailboxOptions): Ledger {
  return {
    schemaVersion: 1,
    captain: { id: 'captain', model: options.captainModel },
    agents: options.agents,
    dispatches: {},
    stopLoss: createStopLossState(options)
  };
}

export function writeLedger(layout: MailboxLayout, ledger: Ledger): void {
  mkdirSync(path.dirname(layout.ledger), { recursive: true });
  writeFileSync(layout.ledger, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}
