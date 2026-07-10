export { validatePlanningOnlyLedgerAuditBoundary } from './suite-impl.ts';
import { validatePlanningOnlyLedgerAuditBoundary } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await validatePlanningOnlyLedgerAuditBoundary(tempRoot);
}
