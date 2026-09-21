// Focused contract test for TASK-PRF-0054: the release workflow must run a
// fail-closed post-publish check against the live public npm registry using
// the exact tagged version, never mutable `latest`, never a `--version`-only
// smoke, never `--record-blocked` (which would let a real registry defect
// silently pass), and never on the workflow_dispatch dry-run path. This is a
// static negative test over the workflow source, matching the existing
// tests/release/release-trust.test.ts pattern — it does not run GitHub
// Actions or touch the public registry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(path.join(root, '.github', 'workflows', 'release-npm.yml'), 'utf8');

// ACC-1: the gate exists, targets the exact tagged version (not a bare
// `--version`/`doctor` smoke), requires the default dist-tag to match it,
// and calls the full-matrix validator script directly.
const gateStepMatch = workflow.match(
  /- name: Verify public npm registry post-publish\n([\s\S]*?)\n\n {6}- name:/
);
assert.ok(gateStepMatch, 'release workflow must declare a "Verify public npm registry post-publish" step');
const gateStep = gateStepMatch[1];

assert.match(
  gateStep,
  /validate-public-npm-install\.ts/,
  'the post-publish gate must invoke the full-matrix public-install validator, not a version-only check'
);
assert.match(
  gateStep,
  /--version\s+"\$release_version"/,
  'the gate must request the exact release version, not registry `latest`'
);
assert.match(
  gateStep,
  /--require-default-tag/,
  'the gate must require the default dist-tag to resolve to the exact release version'
);
assert.doesNotMatch(
  gateStep,
  /--record-blocked/,
  'the real post-publish gate must fail closed on a real defect, not record it as a blocked-but-passing result'
);

// ACC-3: the gate must be absent (skipped) on the workflow_dispatch dry-run
// path, matching the same condition already used by the adjacent
// "Post-publish full validation" step, not a weaker or missing guard.
assert.match(
  workflow,
  /- name: Verify public npm registry post-publish\n {8}if: \$\{\{ always\(\) && !cancelled\(\) && !\(github\.event_name == 'workflow_dispatch' && inputs\.dry_run == true\) \}\}/,
  'the post-publish gate must be skipped (not silently pass) on workflow_dispatch dry-run'
);

// ACC-2: the receipt is uploaded as a downloadable workflow artifact, bound
// to the same output file the validator writes (version, registry metadata,
// tarball digest/bytes/entry count, per-command smoke exit codes).
const publishArtifactMatch = workflow.match(
  /- name: Attach public registry post-publish proof\n([\s\S]*?)\n\n {6}- name:/
);
assert.ok(publishArtifactMatch, 'the post-publish receipt must be attached as a downloadable workflow artifact');
assert.match(publishArtifactMatch[1], /actions\/upload-artifact@v4/);
assert.match(publishArtifactMatch[1], /public-npm-install-post-publish-proof\.md/);
assert.match(
  gateStep,
  /--output release\/public-npm-install-post-publish-proof\.md/,
  'the gate step must write the same file path the artifact step uploads'
);

// The registry serves a new version some time after `npm publish` returns.
// The gate must wait for the exact version and its dist-tag before verifying,
// and fail closed if they never appear, rather than racing the registry.
const waitIndex = gateStep.indexOf('npm view "@ai-atomic-framework/cli@$release_version" version');
const tagWaitIndex = gateStep.indexOf('"dist-tags.$NPM_DIST_TAG"');
const validatorIndex = gateStep.indexOf('validate-public-npm-install.ts');
assert.ok(waitIndex >= 0 && tagWaitIndex >= 0, 'the gate must poll the registry for the exact version and its dist-tag');
assert.ok(waitIndex < validatorIndex && tagWaitIndex < validatorIndex, 'the registry wait must happen before the validator runs');
assert.match(gateStep, /if \[\[ "\$visible" != "true" \]\]; then[\s\S]*?exit 1/, 'a registry that never serves the version must fail the gate');

// ACC-1: the gate must run after the real publish, not before it.
const publishIndex = workflow.indexOf("- name: Publish public workspace closure");
const gateIndex = workflow.indexOf('- name: Verify public npm registry post-publish');
assert.ok(publishIndex >= 0 && gateIndex >= 0 && gateIndex > publishIndex,
  'the post-publish gate must appear after the publish step in the workflow, not before it');

console.log('[release-public-registry-gate.test] ok');
