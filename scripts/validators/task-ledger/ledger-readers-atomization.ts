export { validateTaskLedgerReadersAtomization } from './suite-impl.ts';
import { validateTaskLedgerReadersAtomization } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await validateTaskLedgerReadersAtomization(tempRoot);
}
