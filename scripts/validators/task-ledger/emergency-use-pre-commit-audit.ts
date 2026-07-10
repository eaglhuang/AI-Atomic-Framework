export { validateEmergencyUsePreCommitAudit } from './suite-impl.ts';
import { validateEmergencyUsePreCommitAudit } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await validateEmergencyUsePreCommitAudit(tempRoot);
}
