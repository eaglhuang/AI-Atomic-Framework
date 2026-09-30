import { execFileSync } from 'node:child_process';
import { deliverPr } from './lib/pr-delivery.ts';

// Usage: node --strip-types scripts/deliver-pr.ts --title "..." --body "..." [--dry-run]
// Use only from the owner-approved PR delivery lane. Required CI decides merge.
const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? '' : args[index + 1] ?? '';
};
try {
  const result = deliverPr((program, argv) => execFileSync(program, argv, {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  }), { title: value('--title'), body: value('--body'), dryRun: args.includes('--dry-run') });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ delivered: false, error: String(error), recovery: 'Keep the branch and rerun after fixing the reported step; no force push or protection bypass.' }));
  process.exitCode = 1;
}
