import { runValidateCli } from './validate-cli/orchestrator.ts';

await runValidateCli(process.argv.slice(2));
