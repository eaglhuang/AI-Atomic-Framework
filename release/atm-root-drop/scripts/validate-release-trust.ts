/**
 * validate-release-trust.ts
 *
 * PR-stage validator for the release trust chain.
 *
 * At PR/CI time `release/integrity.json` may not yet exist (it is
 * produced at publish time).  This validator therefore checks:
 *
 *   1. The release workflow publishes the complete public workspace closure
 *      with provenance, public access, and a resolved dist-tag.
 *   2. The release workflow includes a SBOM generation step.
 *   3. The release workflow includes the `build-release-integrity` step.
 *   4. `scripts/build-release-integrity.ts` exists.
 *   5. `packages/cli/src/startup-integrity.ts` exists.
 *   6. If `release/integrity.json` exists, its manifest structure is valid
 *      (schemaVersion / version / artefacts[] / sha256 format).
 *
 * Usage:
 *   node --strip-types scripts/validate-release-trust.ts --mode validate
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
const packageFixturePath = path.join(root, 'tests', 'package-skeleton.fixture.json');
const packageFixture = existsSync(packageFixturePath)
  ? JSON.parse(readFileSync(packageFixturePath, 'utf8')) as {
      packages?: readonly { name?: unknown }[];
      publishClosure?: { publishedPackages?: readonly unknown[] };
    }
  : {};
const skeletonPackageNames = Array.isArray(packageFixture.packages)
  ? packageFixture.packages.map((entry) => entry.name).filter((name): name is string => typeof name === 'string')
  : [];
// Skeleton coverage and publish surface are different obligations. Every
// workspace is skeleton-validated; only the declared publish closure may reach
// npm, so release trust is asserted against that closure rather than against
// the full workspace list.
const publicPackageNames = (packageFixture.publishClosure?.publishedPackages ?? [])
  .filter((name): name is string => typeof name === 'string');

const publishLines = workflow.split(/\r?\n/).filter((line) => line.includes('npm publish'));
assert(publishLines.length >= 2, 'release-npm.yml: must publish the complete workspace closure in both dry-run and release branches');
for (const line of publishLines) {
  assert(line.includes('--provenance'), `release-npm.yml: npm publish line must include --provenance: ${line.trim()}`);
  assert(line.includes('--access public'), `release-npm.yml: npm publish line must make public packages explicitly public: ${line.trim()}`);
  assert(line.includes('--tag "$NPM_DIST_TAG"'), `release-npm.yml: npm publish line must use the resolved NPM_DIST_TAG: ${line.trim()}`);
  assert(line.includes('--workspace "$workspace"'), `release-npm.yml: npm publish line must target one explicit workspace: ${line.trim()}`);
}
assert(workflow.includes('PUBLIC_WORKSPACES=('), 'release-npm.yml: must declare the explicit public workspace closure');
assert(workflow.includes('for workspace in "${PUBLIC_WORKSPACES[@]}"; do'), 'release-npm.yml: must iterate every explicitly declared public workspace');
assert(workflow.includes('npm view "$workspace@$release_version" version --json'), 'release-npm.yml: release retries must skip already-published workspace versions');
assert(!workflow.includes('npm publish --workspaces'), 'release-npm.yml: must not publish example workspaces through --workspaces');
assert(publicPackageNames.length > 0, 'tests/package-skeleton.fixture.json must declare publishClosure.publishedPackages');
for (const packageName of publicPackageNames) {
  assert(workflow.includes(`"${packageName}"`), `release-npm.yml: missing explicit public workspace ${packageName}`);
}
// A workspace outside the declared closure must not be reachable from the
// publish list, or the release silently widens back to the multi-package surface.
for (const packageName of skeletonPackageNames) {
  if (publicPackageNames.includes(packageName)) continue;
  assert(
    !new RegExp(`^\\s*"${packageName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"\\s*$`, 'm').test(workflow),
    `release-npm.yml: ${packageName} is outside publishClosure.publishedPackages and must not be listed for publish`
  );
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
  const testResult = spawnSync(process.execPath, ['--strip-types', path.join(root, 'tests', 'release', 'release-trust.test.ts')], {
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
