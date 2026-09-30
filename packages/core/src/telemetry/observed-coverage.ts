import type { GateTelemetryEvent, GateTelemetryRequiredNodeCoverage } from './index.ts';

export function assessObservedNodeCoverage(
  node: GateTelemetryRequiredNodeCoverage,
  observedEvents: readonly GateTelemetryEvent[]
): GateTelemetryRequiredNodeCoverage {
  if (node.coverageStatus !== 'instrumented' || node.producerCheckIds.length === 0) return node;
  const events = observedEvents.filter((event) => node.producerCheckIds.includes(event.checkId));
  const missingCorrelationKeys = node.requiredCorrelationKeys.filter((key) => events.some((event) => {
    const value = (event as unknown as Record<string, unknown>)[key];
    return typeof value !== 'string' || !value.trim() || value.trim().toLowerCase() === 'unknown';
  }));
  const missingTelemetry = [...new Set([...node.missingTelemetry, ...missingCorrelationKeys, ...(!events.length ? ['observedEvents'] : []), ...events.flatMap((event) => event.result !== 'block' ? [] : [
    ...(!event.reasonClass || ['block', 'unknown', 'error'].includes(event.reasonClass.trim().toLowerCase()) ? ['blockReason'] : []),
    ...(!event.errorCode?.trim() ? ['blockErrorCode'] : []), ...(!event.failureEnvelopeRef?.trim() ? ['failureEnvelopeRef'] : [])
  ])])].sort();
  return {
    ...node,
    missingCorrelationKeys,
    missingTelemetry,
    sourceAvailability: !events.length ? 'unavailable' : missingTelemetry.length ? 'partial' : node.sourceAvailability,
    m2Comparable: node.m2Comparable && events.length > 0 && !missingTelemetry.length
  };
}
