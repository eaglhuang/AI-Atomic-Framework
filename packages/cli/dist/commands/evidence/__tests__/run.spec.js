import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../shared.js';
import { runEvidenceRun } from '../verbs/run.js';
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-evidence-run-'));
const actor = 'cursor-composer-rft0007';
const taskId = 'TASK-RFT-0007';
const findLatestCommandRun = (manifest, predicate) => {
    const runs = manifest
        && typeof manifest === 'object'
        && Array.isArray(manifest.commandRuns)
        ? [...(manifest.commandRuns)]
        : [];
    return runs.reverse().find(predicate);
};
try {
    const pass = runEvidenceRun([
        '--task', taskId,
        '--cwd', cwd,
        '--actor', actor,
        '--command', 'node -e "process.exit(0)"',
        '--validators', 'rft0007-pass-probe',
        '--runner-kind', 'dev-source',
        '--json'
    ]);
    assert.equal(pass.ok, true);
    const passRun = findLatestCommandRun(pass.evidence?.bundleManifest, (run) => run.command === 'node -e "process.exit(0)"'
        && Array.isArray(run.validators)
        && run.validators.includes('rft0007-pass-probe'));
    assert.equal(typeof passRun?.startedAt, 'string');
    assert.equal(typeof passRun?.finishedAt, 'string');
    assert.equal(typeof passRun?.durationMs, 'number');
    assert.ok(passRun?.durationMs >= 0);
    let failed = false;
    try {
        runEvidenceRun([
            '--task', taskId,
            '--cwd', cwd,
            '--actor', actor,
            '--command', 'node -e "process.exit(7)"',
            '--validators', 'rft0007-fail-probe',
            '--runner-kind', 'dev-source',
            '--json'
        ]);
    }
    catch (error) {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND');
        failed = true;
    }
    assert.equal(failed, true);
    const recent = runEvidenceRun([
        '--task', taskId,
        '--cwd', cwd,
        '--actor', actor,
        '--command', 'node -e "process.exit(0)"',
        '--validators', 'rft0007-recent-probe',
        '--runner-kind', 'dev-source',
        '--recent-run',
        '--json'
    ]);
    assert.equal(typeof recent.ok, 'boolean');
    const recentRun = findLatestCommandRun(recent.evidence?.bundleManifest, (run) => run.command === 'node -e "process.exit(0)"'
        && Array.isArray(run.validators)
        && run.validators.includes('rft0007-recent-probe')
        && run.cached === true);
    assert.equal(typeof recentRun?.durationMs, 'number');
    console.log('[run.spec] ok');
}
finally {
    rmSync(cwd, { recursive: true, force: true });
}
