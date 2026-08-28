import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFrameworkRepoIdentity } from '../../packages/cli/src/commands/framework-development.ts';
import { resolveDoctorRepositoryIdentity } from '../../packages/cli/src/commands/doctor/policy.ts';

const workspace = mkdtempSync(path.join(os.tmpdir(), 'atm-root-drop-doctor-identity-'));

try {
  mkdirSync(path.join(workspace, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(path.join(workspace, 'packages', 'cli', 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'package.json'), `${JSON.stringify({
    name: 'ai-atomic-framework',
    workspaces: ['packages/*']
  })}\n`, 'utf8');
  writeFileSync(path.join(workspace, 'packages', 'core', 'src', 'index.ts'), 'export {};\n', 'utf8');
  writeFileSync(path.join(workspace, 'packages', 'cli', 'src', 'atm.ts'), 'export {};\n', 'utf8');

  assert.equal(
    detectFrameworkRepoIdentity(workspace).isFrameworkRepo,
    true,
    'a source checkout with the framework topology must retain framework doctor policy'
  );

  writeFileSync(path.join(workspace, 'release-manifest.json'), `${JSON.stringify({
    schemaVersion: 'atm.rootDropRelease.v0.4',
    entrypoint: 'atm.mjs'
  })}\n`, 'utf8');

  const portableBundle = resolveDoctorRepositoryIdentity(workspace, detectFrameworkRepoIdentity(workspace));
  assert.equal(
    portableBundle.isFrameworkRepo,
    false,
    'a root-drop release manifest must classify the copied bundle as an adopter, not a framework checkout'
  );
  assert.ok(
    portableBundle.signals.includes('release-manifest:atm.rootDropRelease'),
    'the portable-release classification must be observable in the identity evidence'
  );

  console.log('ok: root-drop release manifests select adopter doctor policy');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
