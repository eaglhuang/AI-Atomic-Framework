// @ts-nocheck
import path from 'node:path';
import { CliError, makeResult, message } from '../../shared.ts';
import { createBrokerTicketStore } from '../../../../../core/src/broker/ticket-store.ts';
import { authorityFromTicketStore } from '../../../../../core/src/broker/projections/atomic-broker-projection.ts';
import { reconcileBrokerProjection } from '../../../../../core/src/broker/reconcile/broker-projection-reconcile.ts';
import type { ParsedBrokerOptions } from '../parser.ts';

export function handleBrokerReconcile(options: ParsedBrokerOptions) {
  if (options.action !== 'reconcile') return null;
  if ((options as ParsedBrokerOptions & { reconcileAction?: string | null }).reconcileAction !== 'projection') {
    throw new CliError('ATM_CLI_USAGE', 'broker reconcile requires projection.', { exitCode: 2 });
  }
  if (!options.task || !options.actorId) {
    throw new CliError('ATM_CLI_USAGE', 'broker reconcile projection requires --task and --actor.', { exitCode: 2 });
  }
  if (!options.projectionKey) {
    throw new CliError('ATM_CLI_USAGE', 'broker reconcile projection requires --projection-key <ticket-id>.', { exitCode: 2 });
  }
  const storePath = path.join(options.cwd, '.atm', 'runtime', 'broker-ticket-store.json');
  const projectionPath = path.join(options.cwd, '.atm', 'runtime', 'broker-projections', `${options.projectionKey}.json`);
  const store = createBrokerTicketStore(storePath);
  const authority = authorityFromTicketStore(store.read().document, options.projectionKey);
  const result = reconcileBrokerProjection({
    projectionPath,
    authority,
    now: new Date().toISOString()
  });
  return makeResult({
    ok: true,
    command: 'broker reconcile projection',
    cwd: options.cwd,
    messages: [message('info', 'ATM_BROKER_PROJECTION_RECONCILED', 'Broker projection reconciled against canonical ticket authority.', { status: result.status })],
    evidence: { taskId: options.task, actorId: options.actorId, projectionPath, result }
  });
}
