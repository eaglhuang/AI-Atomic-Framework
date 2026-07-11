export { validateTaskflowCloseOrchestration } from './suite-impl.ts';
import { validateTaskflowCloseOrchestration } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await validateTaskflowCloseOrchestration(tempRoot);
}
