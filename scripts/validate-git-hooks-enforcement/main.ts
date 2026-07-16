import { rmSync } from 'node:fs';
import { mode, tempRoot } from './context.ts';
import { runInitialLanes } from './initial-lanes.ts';
import { runPrePushRegressions } from './pre-push-regressions.ts';
import { runClosureCrossChecks } from './closure-cross-checks.ts';
import { runRootEmergencyAudit } from './root-emergency-audit.ts';

try {
  const { repo } = runInitialLanes();
  const { noHooksDir } = runPrePushRegressions(repo);
  runClosureCrossChecks(noHooksDir);
  runRootEmergencyAudit();
} finally {
  if (!process.exitCode) {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log('TEST FAILED. Keeping temp directory:', tempRoot);
  }
}

if (!process.exitCode) {
  console.log(`[git-hooks-enforcement:${mode}] ok`);
}
