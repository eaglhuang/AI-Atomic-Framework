export { assertTasksNewRejectsRootOutput } from './suite-impl.ts';
import { assertTasksNewRejectsRootOutput } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await assertTasksNewRejectsRootOutput(tempRoot);
}
