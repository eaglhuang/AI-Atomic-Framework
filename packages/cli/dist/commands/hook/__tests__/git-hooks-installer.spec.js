import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hookContractVersion, hookMarker, hookProvider, inspectGitHooks, installGitHooks } from '../git-hooks-installer.js';
const inspection = inspectGitHooks(process.cwd());
assert.equal(inspection.schemaId, 'atm.gitHooksInspection.v1');
assert.equal(typeof inspection.ok, 'boolean');
assert.equal(inspection.installedHookFiles.length, 2);
assert.equal(inspection.repoIdentity.isFrameworkRepo, true);
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-install-'));
try {
    spawnSync('git', ['init'], { cwd: tempRoot, encoding: 'utf8' });
    const firstInstall = installGitHooks(tempRoot, { frameworkRequired: true });
    assert.equal(firstInstall.ok, true);
    const afterFirst = inspectGitHooks(tempRoot, { frameworkRequired: true });
    assert.equal(afterFirst.installedHookFiles.every((entry) => entry.present), true);
    const secondInstall = installGitHooks(tempRoot, { frameworkRequired: true });
    assert.equal(secondInstall.ok, true);
    const afterSecond = inspectGitHooks(tempRoot, { frameworkRequired: true });
    assert.equal(afterSecond.ok, true);
    assert.deepEqual(afterFirst.installedHookFiles.map((entry) => entry.sha256), afterSecond.installedHookFiles.map((entry) => entry.sha256));
}
finally {
    rmSync(tempRoot, { recursive: true, force: true });
}
assert.equal(hookContractVersion, 'atm.integration-hooks/v1');
assert.equal(hookProvider, 'atm-framework-development-hooks/v1');
assert.match(hookMarker, /ATM_INTEGRATION_HOOK/);
console.log('[git-hooks-installer.spec] ok');
