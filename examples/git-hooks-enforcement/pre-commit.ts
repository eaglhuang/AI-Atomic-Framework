import { runHook } from '../../packages/cli/src/commands/hook.ts';

const result = runHook(['pre-commit', '--cwd', process.cwd()]);
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
