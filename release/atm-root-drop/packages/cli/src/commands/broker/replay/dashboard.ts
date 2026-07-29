import { makeResult, message } from '../../shared.ts';
import type { ParsedBrokerOptions } from '../parser.ts';
import { renderReplayDashboardHuman } from '../../../../../core/src/broker/replay/dashboard.ts';
import { buildReplayDashboardViewModel } from './dashboard-view-model.ts';

export function brokerReplayDashboard(options: ParsedBrokerOptions, requiredIntersection: readonly string[]) {
  const { snapshot } = buildReplayDashboardViewModel({
    cwd: options.cwd,
    surfaces: requiredIntersection,
    actorId: options.actorId,
    taskId: options.task
  });
  const human = renderReplayDashboardHuman(snapshot);
  return makeResult({
    ok: snapshot.readiness === 'ready',
    command: 'broker',
    cwd: options.cwd,
    messages: [
      message(snapshot.readiness === 'ready' ? 'info' : 'warn', snapshot.readiness === 'ready' ? 'ATM_BROKER_REPLAY_DASHBOARD_READY' : 'ATM_BROKER_REPLAY_DASHBOARD_NOT_READY', 'Broker replay dashboard projection completed.', {
        digest: snapshot.digest,
        blockerCount: snapshot.blockers.length
      })
    ],
    evidence: {
      schemaId: 'atm.brokerReplayDashboardResult.v1',
      action: 'replay-dashboard',
      snapshot,
      human,
      jsonDigest: snapshot.digest,
      humanDigestSource: snapshot.digest
    }
  });
}
