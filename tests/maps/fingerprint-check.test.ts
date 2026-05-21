import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkMapFingerprint, recordFingerprintCheck } from '../../packages/core/src/maps/fingerprint-checker.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(root, 'tests', 'fixtures', 'fingerprint-check');
const tmpDir = path.join(root, 'tests', 'tmp', 'fingerprint-check');

// Clean up tmp dir before running
if (existsSync(tmpDir)) {
  rmSync(tmpDir, { recursive: true });
}
mkdirSync(tmpDir, { recursive: true });

try {
  // ── [1] No drift when fingerprint matches ─────────────────────────────────
  {
    // First, compute the real fingerprint and update the fixture
    const specPath = path.join(fixtureDir, 'no-drift', 'map.spec.json');
    assert.ok(existsSync(specPath), `Fixture must exist: ${specPath}`);

    const result = await checkMapFingerprint('ATM-TEST-FP-NO-DRIFT', specPath);
    // Update fixture to use the real fingerprint (first run establishes baseline)
    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
    if (spec.semanticFingerprint !== result.currentFingerprint) {
      spec.semanticFingerprint = result.currentFingerprint;
      writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
    }

    // Re-run with updated spec
    const result2 = await checkMapFingerprint('ATM-TEST-FP-NO-DRIFT', specPath);
    assert.equal(result2.driftDetected, false, 'No drift should be detected when fingerprint matches');
    assert.equal(result2.currentFingerprint, result2.recordedFingerprint, 'Fingerprints should match');
    assert.equal(result2.delta, undefined, 'No delta when no drift');
    console.log('[PASS] No drift detection works correctly');
  }

  // ── [2] Drift detected when fingerprint is stale ─────────────────────────
  {
    const specPath = path.join(fixtureDir, 'with-drift', 'map.spec.json');
    assert.ok(existsSync(specPath), `Fixture must exist: ${specPath}`);

    const result = await checkMapFingerprint('ATM-TEST-FP-DRIFT', specPath);
    assert.equal(result.driftDetected, true, 'Drift should be detected with stale fingerprint');
    assert.ok(result.delta, 'Delta should be defined when drift detected');
    assert.ok(result.delta!.reason.toLowerCase().includes('mismatch'), 'Delta reason should mention mismatch');
    console.log('[PASS] Drift detection works correctly');
  }

  // ── [3] Missing fingerprint treated as drift ──────────────────────────────
  {
    const specPath = path.join(fixtureDir, 'no-fingerprint', 'map.spec.json');
    assert.ok(existsSync(specPath), `Fixture must exist: ${specPath}`);

    const result = await checkMapFingerprint('ATM-TEST-NO-FP', specPath);
    assert.equal(result.driftDetected, true, 'Missing fingerprint should be treated as drift');
    assert.ok(result.delta?.reason.toLowerCase().includes('no recorded'), 'Delta should explain missing fingerprint');
    console.log('[PASS] Missing fingerprint handled correctly');
  }

  // ── [4] Record fingerprint check to lineage log ───────────────────────────
  {
    const lineageLogPath = path.join(tmpDir, 'lineage-log.json');
    writeFileSync(lineageLogPath, JSON.stringify({
      schemaId: 'atm.mapLineageLog',
      specVersion: '0.1.0',
      sourceMapId: 'ATM-TEST-RECORD',
      canonicalMapId: 'ATM-TEST-RECORD',
      transitions: []
    }, null, 2));

    const checkResult = {
      mapId: 'ATM-TEST-RECORD',
      currentFingerprint: 'sf:sha256:abc123def456',
      recordedFingerprint: 'sf:sha256:abc123def456',
      driftDetected: false,
      checkTime: new Date().toISOString()
    };

    await recordFingerprintCheck('ATM-TEST-RECORD', lineageLogPath, checkResult);

    const updatedLog = JSON.parse(readFileSync(lineageLogPath, 'utf-8'));
    assert.ok(Array.isArray(updatedLog.transitions), 'Transitions should be an array');
    assert.equal(updatedLog.transitions.length, 1, 'Should have 1 transition');
    assert.equal(updatedLog.transitions[0].type, 'fingerprint-check', 'Transition type should be fingerprint-check');
    assert.deepEqual(updatedLog.transitions[0].result, checkResult, 'Result should match');
    console.log('[PASS] Lineage log recording works correctly');
  }

  console.log('\n✅ All fingerprint-check tests passed');
} catch (err) {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
} finally {
  // Clean up tmp dir
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
}
