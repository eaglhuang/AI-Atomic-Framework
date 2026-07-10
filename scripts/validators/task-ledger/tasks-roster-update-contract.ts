export { assertTasksRosterUpdateContract } from './suite-impl.ts';
import { assertTasksRosterUpdateContract } from './suite-impl.ts';
export async function run(tempRoot: string) {
  await assertTasksRosterUpdateContract();
}
