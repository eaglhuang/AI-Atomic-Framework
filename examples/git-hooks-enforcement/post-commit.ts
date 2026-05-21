import { runDoctor } from '../../packages/cli/src/commands/doctor.ts';

const result = await runDoctor(['--cwd', process.cwd(), '--json']);
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
