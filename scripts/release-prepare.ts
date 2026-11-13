import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseVersionBase } from './lib/release-version-compatibility.ts';
import { synchronizeReleaseWorkspaceVersions } from './set-release-workspace-versions.ts';

/**
 * Source manifests on the default branch must already carry the version a
 * release tag announces. The publish workflow only verifies this; it never
 * writes versions back, so the tagged commit and its frozen runner report the
 * same version that npm receives.
 */
export function releaseTagMatchesSourceVersion(tag: string, sourceVersion: string): boolean {
  const base = releaseVersionBase(tag);
  return base !== null && base === releaseVersionBase(sourceVersion) && base === sourceVersion.trim();
}

function readRootVersion(root: string): string {
  return String(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '');
}

function readFlag(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function main(): void {
  const root = path.resolve(readFlag('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const checkTag = readFlag('--check-tag');
  if (checkTag) {
    const sourceVersion = readRootVersion(root);
    if (!releaseTagMatchesSourceVersion(checkTag, sourceVersion)) {
      console.error(`[release-prepare] tag ${checkTag} does not match source version ${sourceVersion}. Run "npm run release:prepare -- --version ${releaseVersionBase(checkTag) ?? '<semver>'}" in a release PR, merge it, then tag that commit.`);
      process.exit(1);
    }
    console.log(`[release-prepare] tag ${checkTag} matches source version ${sourceVersion}`);
    return;
  }
  const version = readFlag('--version');
  if (!version || releaseVersionBase(version) !== version) {
    throw new Error('usage: release-prepare --version <MAJOR.MINOR.PATCH> | --check-tag <tag> [--root <path>]');
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = (args: string[]) => execFileSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  run(['version', version, '--workspaces', '--include-workspace-root', '--no-git-tag-version', '--no-workspaces-update', '--allow-same-version']);
  synchronizeReleaseWorkspaceVersions(root, version);
  run(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
  console.log(`[release-prepare] source versions set to ${version}. Rebuild the frozen runner, then commit in the release PR.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
