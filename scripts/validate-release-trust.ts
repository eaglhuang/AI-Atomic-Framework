/**
 * validate-release-trust.ts
 *
 * PR-stage validator for the release trust chain.
 *
 * At PR/CI time `release/integrity.json` may not yet exist (it is
 * produced at publish time).  This validator therefore checks:
 *
 *   1. The release workflow declares `--provenance` on every `npm publish` step.
 *   2. The release workflow includes a SBOM generation step.
 *   3. The release workflow includes the `build-release-integrity` step.
 *   4. `scripts/build-release-integrity.ts` exists.
 *   5. `packages/cli/src/startup-integrity.ts` exists.
 *   6. If `release/integrity.json` exists, its manifest structure is valid
 *      (schemaVersion / version / artefacts[] / sha256 format).
 *
 * Usage:
 *   node --experimental-strip-types scripts/validate-release-trust.ts --mode validate
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string) {
  console.error(`[release-trust:${mode}] FAIL ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ---------------------------------------------------------------------------
// 1–3. Release workflow checks
// ---------------------------------------------------------------------------

const workflowPath = path.join(root, '.github', 'workflows', 'release-npm.yml');
assert(existsSync(workflowPath), '.github/workflows/release-npm.yml must exist');

const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '';

const publishLines = workflow.split(/\r?\n/).filter((line) => line.includes('npm publish'));
assert(publishLines.length >= 2, 'release-npm.yml: must publish both ATM CLI and create-atm packages');
for (const line of publishLines) {
  assert(line.includes('--provenance'), `release-npm.yml: npm publish line must include --provenance: ${line.trim()}`);
}

assert(/workflow_dispatch/.test(workflow) && /dry_run/.test(workflow), 'release-npm.yml: must expose workflow_dispatch dry_run mode');
assert(/--dry-run/.test(workflow), 'release-npm.yml: dry-run mode must call npm publish --dry-run with --provenance');

assert(
  /sbom|cdxgen|cyclonedx/i.test(workflow),
  'release-npm.yml: must include an SBOM generation step (cdxgen / cyclonedx / sbom keyword)'
);

assert(
  /build-release-integrity/.test(workflow),
  'release-npm.yml: must invoke scripts/build-release-integrity.ts before publish'
);

// ---------------------------------------------------------------------------
// 4–5. Required source files
// ---------------------------------------------------------------------------

assert(
  existsSync(path.join(root, 'scripts', 'build-release-integrity.ts')),
  'scripts/build-release-integrity.ts must exist'
);

assert(
  existsSync(path.join(root, 'packages', 'cli', 'src', 'startup-integrity.ts')),
  'packages/cli/src/startup-integrity.ts must exist'
);

assert(
  existsSync(path.join(root, 'tests', 'release', 'release-trust.test.ts')),
  'tests/release/release-trust.test.ts must exist'
);

// ---------------------------------------------------------------------------
// 6. Optional manifest structure check (when present)
// ---------------------------------------------------------------------------

const manifestPath = path.join(root, 'release', 'integrity.json');
if (existsSync(manifestPath)) {
  let manifest: any;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    fail('release/integrity.json: cannot be parsed as JSON');
    process.exit(1);
  }

  assert(
    manifest.schemaVersion === 'atm.releaseIntegrity.v0.1',
    `release/integrity.json: schemaVersion must be "atm.releaseIntegrity.v0.1", got "${manifest.schemaVersion}"`
  );
  assert(
    typeof manifest.version === 'string' && manifest.version.length > 0,
    'release/integrity.json: version must be a non-empty string'
  );
  assert(
    typeof manifest.buildAt === 'string' && manifest.buildAt.length > 0,
    'release/integrity.json: buildAt must be a non-empty string'
  );
  assert(
    Array.isArray(manifest.artefacts) && manifest.artefacts.length > 0,
    'release/integrity.json: artefacts must be a non-empty array'
  );

  if (Array.isArray(manifest.artefacts)) {
    for (let i = 0; i < manifest.artefacts.length; i++) {
      const entry = manifest.artefacts[i];
      assert(
        typeof entry.path === 'string' && entry.path.length > 0,
        `release/integrity.json artefacts[${i}]: path must be a non-empty string`
      );
      assert(
        typeof entry.sha256 === 'string' && /^sha256:[0-9a-f]{64}$/.test(entry.sha256),
        `release/integrity.json artefacts[${i}]: sha256 must match "sha256:<64 hex chars>", got "${entry.sha256}"`
      );
    }
  }

  if (!process.exitCode) {
    console.log(`[release-trust:${mode}] integrity manifest structure ok (${manifest.artefacts?.length ?? 0} artefact(s))`);
  }
} else {
  console.log(`[release-trust:${mode}] release/integrity.json not present — skipping manifest structure check (expected at publish time)`);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

if (!process.exitCode) {
  const testResult = spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'tests', 'release', 'release-trust.test.ts')], {
    cwd: root,
    encoding: 'utf8'
  });
  if (testResult.status !== 0) {
    fail(`tests/release/release-trust.test.ts failed\nstdout:\n${testResult.stdout}\nstderr:\n${testResult.stderr}`);
  }
}

if (!process.exitCode) {
  console.log(`[release-trust:${mode}] ok — release trust chain contract verified`);
}
