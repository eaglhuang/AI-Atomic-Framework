export { validateClosurePacketDirtyTreeHygieneGuard } from './suite-impl.ts';
import { validateClosurePacketDirtyTreeHygieneGuard } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await validateClosurePacketDirtyTreeHygieneGuard(tempRoot);
}
