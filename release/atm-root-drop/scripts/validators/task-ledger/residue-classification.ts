export { validateTaskResidueClassification } from './suite-impl.ts';
import { validateTaskResidueClassification } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await validateTaskResidueClassification(tempRoot);
}
