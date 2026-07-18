import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fail, runTimedSection } from './context.ts';
import {
  validateAdopterGoverned,
  validateAaoThroughputAgentJourney,
  validateBatchCheckpointHold,
  validateTaskSelfAllowOnClaim,
  validateTasksClaimDirectionLockConsistency
} from './adopter-core.ts';
import { validateFrameworkDevelopment } from './framework-development.ts';
import { validateNextClaimPromptScopeConsistency, validateOutOfScopeSubtraction } from './prompt-scope.ts';
import { validateSameFileParallelClaimAdmission, validateSameFilePreCommitOwnership } from './same-file-ownership.ts';

export async function runTaskDirectionGovernanceValidator() {
  const onlySection = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : null;
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-governance-'));
  try {
    const sections: Array<[string, (tempRoot: string) => Promise<void>]> = [
      ['validateAdopterGoverned', validateAdopterGoverned],
      ['validateBatchCheckpointHold', validateBatchCheckpointHold],
      ['validateAaoThroughputAgentJourney', validateAaoThroughputAgentJourney],
      ['validateFrameworkDevelopment', validateFrameworkDevelopment],
      ['validateTaskSelfAllowOnClaim', validateTaskSelfAllowOnClaim],
      ['validateTasksClaimDirectionLockConsistency', validateTasksClaimDirectionLockConsistency],
      ['validateNextClaimPromptScopeConsistency', validateNextClaimPromptScopeConsistency],
      ['validateOutOfScopeSubtraction', validateOutOfScopeSubtraction],
      ['validateSameFileParallelClaimAdmission', validateSameFileParallelClaimAdmission],
      ['validateSameFilePreCommitOwnership', validateSameFilePreCommitOwnership]
    ];
    for (const [name, fn] of sections) {
      if (onlySection && onlySection !== name) continue;
      await runTimedSection(name, () => fn(tempRoot));
    }
    if (onlySection && !sections.some(([name]) => name === onlySection)) {
      fail(`unknown --only section ${onlySection}`);
    }
    if (!process.exitCode) {
      console.log('[task-direction-governance:validate] ok (adopter-governed and framework-development task direction gates verified)');
      process.exit(0);
    }
  } finally {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

