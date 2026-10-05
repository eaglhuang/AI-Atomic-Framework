import { accessSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { inspectFrameworkIdentity, identityMetadataByteLimit } from '../../../../core/src/project/framework-identity.ts';
import { assertNoSymlinkPath } from '../../../../integrations-core/src/manifest/safe-install.ts';
import { createV1AtmPaths, createV2AtmPaths } from '../governance-runtime.ts';
import { validateProfile } from '../taskflow/profile-loader.ts';
import { validateProjectTargetLocation } from '../setup/target.ts';

export type FirstRunTargetState = 'selection-required' | 'unsafe-target' | 'missing-target' | 'invalid-config'
  | 'legacy-layout' | 'uninitialized' | 'partial' | 'ready' | 'ambiguous-identity' | 'runtime-distribution';

const initializationContainers = ['.atm', '.atm/runtime', '.atm/history', '.atm/catalog'] as const;

export interface FirstRunTarget {
  readonly root: string | null;
  readonly state: FirstRunTargetState;
  readonly identity: ReturnType<typeof inspectFrameworkIdentity> | null;
  readonly layoutVersion: number | null;
  readonly recordedVersion: string | null;
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
  readonly reason: string;
}

/** Initialization shape only. No history scans, subprocesses, mutation,
 * home-config discovery, or claim/health/readiness authority. */
export function inspectFirstRunTarget(selectedRoot: string | null, home = homedir(), env = process.env): FirstRunTarget {
  const base = { root: selectedRoot ? path.resolve(selectedRoot) : null, identity: null, layoutVersion: null,
    recordedVersion: null, missing: [] as string[], invalid: [] as string[] };
  const result = (state: FirstRunTargetState, reason: string, extra: Partial<FirstRunTarget> = {}): FirstRunTarget => ({ ...base, state, reason, ...extra });
  if (!base.root) return result('selection-required', 'Select the project explicitly with --cwd; the runtime installation is not an implied target.');
  const root = base.root;
  try {
    validateProjectTargetLocation(root, home, env);
    assertNoSymlinkPath(root);
    if (!lstatSync(root).isDirectory()) return result('unsafe-target', 'The selected target is not a directory.');
    accessSync(root, constants.R_OK | constants.X_OK);
    base.root = realpathSync(root);
  } catch (error) {
    return result((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-target' : 'unsafe-target', 'The selected target is missing, unreadable, or crosses a symbolic link.');
  }
  const identity = inspectFrameworkIdentity(root);
  const detail = { identity };
  if (identity.kind === 'distribution') return result('runtime-distribution', 'Select the project to govern, not the portable runtime distribution.', detail);
  if (identity.kind === 'ambiguous') return result('ambiguous-identity', 'Framework identity is incomplete. Preserve existing governance and inspect the repository markers before routing.', detail);
  for (const container of initializationContainers) {
    if (inspectMetadata(root, container, 'directory').state === 'unsafe') {
      return result('unsafe-target', 'Reserved ATM metadata paths must be readable directories without symbolic links.', { ...detail, invalid: [container] });
    }
  }
  const config = inspectMetadata(root, '.atm/config.json');
  if (config.state === 'unsafe') return result('unsafe-target', 'ATM metadata crosses an unsafe path; preserve it and select or repair the target explicitly.', detail);
  if (config.state === 'invalid') return result('invalid-config', 'Preserve and inspect invalid ATM configuration; no automatic repair is authorized.', { ...detail, invalid: ['.atm/config.json'] });
  if (config.state === 'missing') {
    const atm = inspectMetadata(root, '.atm', 'directory');
    return result(atm.state === 'missing' ? 'uninitialized' : atm.state === 'invalid' || atm.state === 'unsafe' ? 'unsafe-target' : 'partial',
      atm.state === 'missing' ? 'ATM is not initialized in this project.' : 'ATM metadata exists without a valid configuration; preserve it before setup.',
      { ...detail, missing: ['.atm/config.json'] });
  }
  const value = config.value!;
  if (value.schemaVersion !== 'atm.config.v0.1' || ![1, 2].includes(value.layoutVersion as number)
    || (value.frameworkVersion !== undefined && (typeof value.frameworkVersion !== 'string' || !value.frameworkVersion.trim()))) {
    return result('invalid-config', 'ATM configuration has an unsupported schema, layout, or version value.', { ...detail, invalid: ['.atm/config.json'] });
  }
  const layoutVersion = value.layoutVersion as number;
  const recordedVersion = typeof value.frameworkVersion === 'string' ? value.frameworkVersion : null;
  const paths = layoutVersion === 2 ? createV2AtmPaths() : createV1AtmPaths();
  const metadata = [
    [paths.profilePath, 'text'], [paths.projectProbePath, 'json'], [paths.defaultGuardsPath, 'json'], [paths.contextBudgetPolicyPath, 'json']
  ] as const;
  const missing: string[] = [], invalid: string[] = [];
  for (const [relative, type] of metadata) {
    const observed = inspectMetadata(root, relative, type);
    if (observed.state === 'unsafe') return result('unsafe-target', 'ATM metadata is unreadable, unbounded, or uses an unsafe path/type; no executable route is suggested.', { ...detail, invalid: [relative.replaceAll('\\', '/')] });
    if (observed.state === 'missing') missing.push(relative.replaceAll('\\', '/'));
    if (observed.state === 'invalid') invalid.push(relative.replaceAll('\\', '/'));
  }
  // Adopters use the same official profile validator as taskflow. Framework
  // projects may keep planning elsewhere; this does not invent a local profile.
  if (identity.kind === 'adopter') {
    const profile = inspectMetadata(root, 'taskflow.profile.json');
    if (profile.state === 'unsafe') return result('unsafe-target', 'Taskflow profile is unreadable, unbounded, or uses an unsafe path/type; no executable route is suggested.', detail);
    if (profile.state === 'missing') missing.push('taskflow.profile.json');
    else if (profile.state === 'invalid') invalid.push('taskflow.profile.json');
    else {
      try { validateProfile(profile.value); }
      catch { invalid.push('taskflow.profile.json'); }
    }
  }
  const facts = { ...detail, layoutVersion, recordedVersion, missing, invalid };
  if (invalid.length) return result('invalid-config', 'Existing metadata is invalid; preserve it and use read-only diagnosis.', facts);
  if (layoutVersion !== 2) return result('legacy-layout', 'Legacy governance layout requires the runtime-supported diagnostic or migration route.', facts);
  if (missing.length) return result('partial', 'Initialization is incomplete; use official bootstrap, preserving existing files.', facts);
  return result('ready', 'Initialization shape is ready to ask next; this is not health, agent readiness, or write admission.', facts);
}

function inspectMetadata(root: string, relative: string, type: 'json' | 'text' | 'directory' = 'json'):
  { state: 'missing' | 'invalid' | 'present' | 'unsafe'; value?: Record<string, unknown> } {
  try {
    const file = path.join(root, relative);
    assertNoSymlinkPath(file);
    const stat = lstatSync(file);
    if (type === 'directory') {
      if (!stat.isDirectory()) return { state: 'unsafe' };
      accessSync(file, constants.R_OK | constants.X_OK);
      return { state: 'present' };
    }
    if (!stat.isFile() || stat.size > identityMetadataByteLimit) return { state: 'unsafe' };
    // Recheck the opened object and cap the read itself, not only the initial
    // path stat. Nonblocking open prevents a concurrent FIFO replacement from
    // hanging; no-follow is used where the operating system supports it.
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.size > identityMetadataByteLimit) return { state: 'unsafe' };
      const buffer = Buffer.alloc(opened.size + 1);
      const count = readSync(fd, buffer, 0, buffer.length, 0);
      if (count !== opened.size || fstatSync(fd).size !== opened.size) return { state: 'unsafe' };
      bytes = buffer.subarray(0, count);
    } finally { closeSync(fd); }
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) return { state: 'invalid' };
    if (type === 'text') return { state: text.trim() ? 'present' : 'invalid' };
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length
      ? { state: 'present', value: value as Record<string, unknown> } : { state: 'invalid' };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ATM_SETUP_UNSAFE_PATH:')) return { state: 'unsafe' };
    const code = (error as NodeJS.ErrnoException).code;
    return { state: code === 'ENOENT' ? 'missing' : code ? 'unsafe' : 'invalid' };
  }
}
