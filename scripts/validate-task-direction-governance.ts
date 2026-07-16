import { runTaskDirectionGovernanceValidator } from './validate-task-direction-governance/main.ts';

await runTaskDirectionGovernanceValidator().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
