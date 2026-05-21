import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { checkMapFingerprint, recordFingerprintCheck } from '../../packages/core/src/maps/fingerprint-checker.ts';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const fixtureDir = path.join(import.meta.url.replace('file://', '').split('/').slice(0, -3).join('/'), 'fixtures', 'fingerprint-check');

describe('fingerprint-checker', () => {
  describe('checkMapFingerprint', () => {
    it('should detect no drift when fingerprint matches', async () => {
      const mapId = 'ATM-TEST-FP-NO-DRIFT';
      const specPath = path.join(fixtureDir, 'no-drift', 'map.spec.json');

      const result = await checkMapFingerprint(mapId, specPath);

      expect(result.driftDetected).toBe(false);
      expect(result.delta).toBeUndefined();
      expect(result.currentFingerprint).toBe(result.recordedFingerprint);
    });

    it('should detect drift when fingerprint changes', async () => {
      const mapId = 'ATM-TEST-FP-DRIFT';
      const specPath = path.join(fixtureDir, 'with-drift', 'map.spec.json');

      const result = await checkMapFingerprint(mapId, specPath);

      expect(result.driftDetected).toBe(true);
      expect(result.delta).toBeDefined();
      expect(result.delta?.reason).toContain('mismatch');
    });

    it('should handle missing fingerprint gracefully', async () => {
      const mapId = 'ATM-TEST-NO-FP';
      const specPath = path.join(fixtureDir, 'no-fingerprint', 'map.spec.json');

      const result = await checkMapFingerprint(mapId, specPath);

      expect(result.driftDetected).toBe(true);
      expect(result.delta?.reason).toContain('No recorded fingerprint');
    });
  });

  describe('recordFingerprintCheck', () => {
    it('should append check result to lineage log', async () => {
      const mapId = 'ATM-TEST-RECORD';
      const tempDir = path.join(import.meta.url.replace('file://', '').split('/').slice(0, -3).join('/'), 'tmp');
      mkdirSync(tempDir, { recursive: true });
      const lineageLogPath = path.join(tempDir, 'lineage-log.json');

      // Initialize lineage log
      writeFileSync(lineageLogPath, JSON.stringify({
        schemaId: 'atm.mapLineageLog',
        specVersion: '0.1.0',
        sourceMapId: mapId,
        canonicalMapId: mapId,
        transitions: []
      }, null, 2));

      const checkResult = {
        mapId,
        currentFingerprint: 'sf:sha256:abc123',
        recordedFingerprint: 'sf:sha256:abc123',
        driftDetected: false,
        checkTime: new Date().toISOString()
      };

      await recordFingerprintCheck(mapId, lineageLogPath, checkResult);

      const updatedLog = JSON.parse(readFileSync(lineageLogPath, 'utf-8'));
      expect(updatedLog.transitions).toHaveLength(1);
      expect(updatedLog.transitions[0].type).toBe('fingerprint-check');
      expect(updatedLog.transitions[0].result).toEqual(checkResult);
    });
  });
});
