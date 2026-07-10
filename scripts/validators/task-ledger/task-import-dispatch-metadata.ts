export { validateTaskImportDispatchMetadataPreservation } from './suite-impl.ts';
import { validateTaskImportDispatchMetadataPreservation } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await validateTaskImportDispatchMetadataPreservation(tempRoot);
}
