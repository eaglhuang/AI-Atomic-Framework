import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const STABLE_LAUNCHER_TEMPLATE_RELATIVE_PATH = 'scripts/templates/atm-stable-launcher.mjs';

export function resolveStableLauncherTemplatePath(repositoryRoot = repoRoot): string {
  return path.join(repositoryRoot, STABLE_LAUNCHER_TEMPLATE_RELATIVE_PATH);
}

export function isOnefileLauncherContent(content: string): boolean {
  return content.includes('const payloadSha256 =')
    && content.includes('atm-onefile-cache')
    && content.includes('Embedded payload hash mismatch');
}

export function readLauncherContent(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

export function assertRootLauncherSafeForReleaseBuild(repositoryRoot: string): void {
  const rootLauncherPath = path.join(repositoryRoot, 'atm.mjs');
  if (!existsSync(rootLauncherPath)) {
    throw new Error('Root atm.mjs is missing; restore it from scripts/templates/atm-stable-launcher.mjs.');
  }
  const content = readLauncherContent(rootLauncherPath);
  if (isOnefileLauncherContent(content)) {
    throw new Error([
      'Root atm.mjs appears to be a copied onefile launcher.',
      'Do not copy release/atm-onefile/atm.mjs over the repository root launcher.',
      'Restore root atm.mjs from scripts/templates/atm-stable-launcher.mjs, then rerun npm run build.',
      'For source-first framework work, use node atm.dev.mjs ... instead of node atm.mjs ...'
    ].join(' '));
  }
}

export function assertPayloadLauncherIsNotNested(launcherPath: string): void {
  if (!existsSync(launcherPath)) {
    throw new Error(`Release payload launcher is missing: ${launcherPath}`);
  }
  const content = readLauncherContent(launcherPath);
  if (isOnefileLauncherContent(content)) {
    throw new Error([
      'Release payload contains a nested onefile launcher at atm.mjs.',
      'Root-drop release must ship the stable launcher template, not a onefile artifact.',
      'Restore root atm.mjs from scripts/templates/atm-stable-launcher.mjs and rebuild.'
    ].join(' '));
  }
}

export function assertStableLauncherTemplatePresent(repositoryRoot = repoRoot): void {
  const templatePath = resolveStableLauncherTemplatePath(repositoryRoot);
  if (!existsSync(templatePath)) {
    throw new Error(`Stable launcher template is missing: ${STABLE_LAUNCHER_TEMPLATE_RELATIVE_PATH}`);
  }
  const content = readLauncherContent(templatePath);
  if (isOnefileLauncherContent(content)) {
    throw new Error('Stable launcher template must not be a onefile launcher.');
  }
  if (!content.includes('atm.dev.mjs')) {
    throw new Error('Stable launcher template must reference node atm.dev.mjs for source-first development.');
  }
}
