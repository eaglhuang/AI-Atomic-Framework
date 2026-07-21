import {
  rearbitrateLinkedSurfaceScope,
  type BrokerRearbitrationReceipt,
  type LinkedSurfaceClosureReceipt
} from '../../../../../core/src/scope/linked-surface/index.ts';

export type ScopeAmendmentRearbitrationReceipt = Readonly<{
  schemaId: 'atm.scopeAmendment.linkedSurfaceRearbitration.v1';
  ok: boolean;
  errorCode: 'ATM_BROKER_REARBITRATION_REQUIRED' | null;
  amendmentPaths: readonly string[];
  rearbitration: BrokerRearbitrationReceipt;
}>;

export function buildScopeAmendmentRearbitration(input: {
  readonly closure: LinkedSurfaceClosureReceipt;
  readonly currentScope: readonly string[];
  readonly ticketReadSet: readonly string[];
  readonly ticketWriteSet: readonly string[];
}): ScopeAmendmentRearbitrationReceipt {
  const current = new Set(input.currentScope.map((surface) => surface.replace(/\\/g, '/')));
  const amendmentPaths = input.closure.requiredSurfaces.filter((surface) => !current.has(surface));
  const rearbitration = rearbitrateLinkedSurfaceScope({
    closure: input.closure,
    ticketReadSet: input.ticketReadSet,
    ticketWriteSet: input.ticketWriteSet
  });
  return {
    schemaId: 'atm.scopeAmendment.linkedSurfaceRearbitration.v1',
    ok: amendmentPaths.length === 0 && !rearbitration.required,
    errorCode: rearbitration.errorCode,
    amendmentPaths,
    rearbitration
  };
}
