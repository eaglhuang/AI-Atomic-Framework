import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStructuredArtifactArtifacts } from './lib/structured-artifact-admission-runner.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const outDir = path.join(root, 'artifacts', 'generated', 'structured-artifact-admission', '20260627-phase-b');

const result = writeStructuredArtifactArtifacts(root, outDir);

console.log(JSON.stringify({
  outDir: outDir.replace(/\\/g, '/'),
  scenarioCount: result.summary.scenarioCount,
  matchedCount: result.summary.matchedCount,
  verdictCounts: result.summary.verdictCounts,
  shipSafe: result.summary.shipSafe
}, null, 2));
