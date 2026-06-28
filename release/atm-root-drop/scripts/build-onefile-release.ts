import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.ts';
import { finalizeBuildReleaseHygiene } from './build-release-hygiene.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDropReleaseRoot = path.join(repoRoot, 'release', 'atm-root-drop');
const onefileReleaseRoot = path.join(repoRoot, 'release', 'atm-onefile');
const deterministicGeneratedAt = '1970-01-01T00:00:00.000Z';

export function buildOnefileRelease(options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const rootDropRoot = path.resolve(options.rootDropRoot ?? rootDropReleaseRoot);
  const outputRoot = path.resolve(options.outputRoot ?? onefileReleaseRoot);
  const outputFilePath = path.join(outputRoot, 'atm.mjs');

  if (!existsSync(rootDropRoot)) {
    buildRootDropRelease({ repositoryRoot, releaseRoot: rootDropRoot });
  }

  const payloadFiles = collectPayloadFiles(rootDropRoot);
  const payload = {
    schemaVersion: 'atm.onefilePayload.v0.1',
    generatedAt: resolveReleaseGeneratedAt(),
    sourceRoot: 'release/atm-root-drop',
    entrypoint: 'atm.mjs',
    files: payloadFiles
  };
  const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  const payloadCompressed = gzipSync(payloadBuffer, { level: 9 });
  const payloadBase64 = payloadCompressed.toString('base64');
  const payloadSha256 = createHash('sha256').update(payloadCompressed).digest('hex');
  const runtimeSource = renderOnefileRuntime({
    payloadBase64,
    payloadSha256
  });

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(outputFilePath, runtimeSource, 'utf8');

  const readmePath = path.join(outputRoot, 'README.onefile.md');
  writeFileSync(readmePath, `${[
    '# ATM One-File Release',
    '',
    'This artifact is a single-file ATM launcher with embedded payload.',
    '',
    '## Entry',
    '',
    '`node atm.mjs next --prompt "<current user prompt>" --json`',
    '',
    '## Prompt',
    '',
    'Read README.md if present, then run "node atm.mjs next --prompt \\"<current user prompt>\\" --json" from the repository root before task work. Use "node atm.mjs next --json" only as read-only orientation when no user prompt is available. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action.'
  ].join('\n')}\n`, 'utf8');
  const manifestPath = path.join(outputRoot, 'release-manifest.json');
  const generatedFiles = collectGeneratedArtifactPaths(outputRoot, 'release/atm-onefile', [
    'release-manifest.json'
  ]);
  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 'atm.onefileRelease.v0.2',
    generatedAt: payload.generatedAt,
    entrypoint: 'atm.mjs',
    payloadSha256,
    sourceRoot: 'release/atm-root-drop',
    fileCount: payloadFiles.length,
    generatedFiles,
    stagingContract: {
      schemaId: 'atm.generatedArtifactStaging.v1',
      generatedFiles,
      ignoredByDefault: true,
      requiresExplicitStaging: true,
      contractSurface: 'release-manifest.json',
      dependsOnRootDropManifest: 'release/atm-root-drop/release-manifest.json',
      rationale: 'release/atm-onefile is generated under the repo ignore boundary; stage these generated files explicitly and treat the root-drop manifest as the upstream artifact list.'
    }
  }, null, 2)}\n`, 'utf8');

  return {
    outputRoot,
    outputFilePath,
    manifestPath,
    payloadSha256,
    fileCount: payloadFiles.length
  };
}

function resolveReleaseGeneratedAt() {
  const explicit = process.env.ATM_RELEASE_GENERATED_AT ?? null;
  if (explicit) {
    return explicit;
  }
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH ?? null;
  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }
  return deterministicGeneratedAt;
}

function collectPayloadFiles(root: any) {
  const files: any[] = [];
  for (const absolutePath of walkFiles(root)) {
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
    const stats = statSync(absolutePath);
    files.push({
      path: relativePath,
      mode: stats.mode & 0o777,
      dataBase64: readFileSync(absolutePath).toString('base64')
    });
  }
  return files;
}

function collectGeneratedArtifactPaths(root: string, repoRelativeRoot: string, appendFiles: readonly string[] = []) {
  const generated = new Set<string>();
  for (const absolutePath of walkFiles(root)) {
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
    if (!relativePath) continue;
    generated.add(`${repoRelativeRoot}/${relativePath}`);
  }
  for (const relativePath of appendFiles) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized) {
      generated.add(`${repoRelativeRoot}/${normalized}`);
    }
  }
  return [...generated].sort();
}

function walkFiles(directory: any): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(absolutePath);
    }
    return [absolutePath];
  });
}

function renderOnefileRuntime({ payloadBase64, payloadSha256 }: any) {
  return `#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const payloadBase64 = ${JSON.stringify(payloadBase64)};
const payloadSha256 = ${JSON.stringify(payloadSha256)};

function fail(message, code = 1) {
  process.stderr.write(\`[atm-onefile] \${message}\\n\`);
  process.exit(code);
}

function normalizePortablePath(relativePath) {
  return String(relativePath || '').replace(/\\\\/g, '/');
}

function resolveFilePath(root, relativePath) {
  const portablePath = normalizePortablePath(relativePath);
  const resolved = path.resolve(root, portablePath);
  const protectedRoot = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(protectedRoot)) {
    throw new Error(\`Path escapes extraction root: \${portablePath}\`);
  }
  return resolved;
}

function decodePayload() {
  const compressed = Buffer.from(payloadBase64, 'base64');
  const digest = createHash('sha256').update(compressed).digest('hex');
  if (digest !== payloadSha256) {
    throw new Error('Embedded payload hash mismatch.');
  }
  return JSON.parse(gunzipSync(compressed).toString('utf8'));
}

function readPositiveIntEnv(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function sleepMs(durationMs) {
  const waitMs = Math.max(1, Math.floor(durationMs));
  if (typeof SharedArrayBuffer === 'function' && typeof Atomics?.wait === 'function') {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, waitMs);
    return;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    // Fallback only for runtimes without Atomics.wait.
  }
}

function resolveCacheBaseRoot() {
  return process.env.ATM_ONEFILE_CACHE_ROOT
    ? path.resolve(process.env.ATM_ONEFILE_CACHE_ROOT)
    : path.join(os.tmpdir(), 'atm-onefile-cache');
}

function extractionLockRoot(cacheRoot) {
  return \`\${cacheRoot}.lock\`;
}

function isExtractedRootReady(cacheRoot) {
  return existsSync(path.join(cacheRoot, '.payload-ready.json'))
    && existsSync(path.join(cacheRoot, 'atm.mjs'));
}

function tryAcquireExtractionLock(lockRoot) {
  try {
    mkdirSync(lockRoot, { recursive: false });
    writeFileSync(path.join(lockRoot, 'owner.json'), JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      payloadSha256
    }, null, 2) + '\\n');
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

function releaseExtractionLock(lockRoot) {
  rmSync(lockRoot, { recursive: true, force: true });
}

function extractPayload(cacheRoot) {
  const payload = decodePayload();
  const stagingRoot = \`\${cacheRoot}.staging-\${process.pid}-\${Date.now()}\`;
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  try {
    for (const file of payload.files) {
      const absolutePath = resolveFilePath(stagingRoot, file.path);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, Buffer.from(file.dataBase64, 'base64'));
      if (typeof file.mode === 'number' && process.platform !== 'win32') {
        try {
          const current = statSync(absolutePath);
          if ((current.mode & 0o777) !== file.mode) {
            chmodSync(absolutePath, file.mode);
          }
        } catch {
          // ignore mode sync failures
        }
      }
    }
    writeFileSync(path.join(stagingRoot, '.payload-ready.json'), JSON.stringify({
      schemaVersion: payload.schemaVersion,
      generatedAt: payload.generatedAt,
      payloadSha256
    }, null, 2) + '\\n');
    rmSync(cacheRoot, { recursive: true, force: true });
    mkdirSync(path.dirname(cacheRoot), { recursive: true });
    // Use rename semantics through copy-less move by relying on same root.
    // On Windows, rename over existing path fails, so cacheRoot is removed above.
    renameSync(stagingRoot, cacheRoot);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function waitForExtractedRoot(cacheRoot) {
  const lockRoot = extractionLockRoot(cacheRoot);
  const timeoutMs = readPositiveIntEnv('ATM_ONEFILE_EXTRACT_LOCK_TIMEOUT_MS', 15000);
  const pollMs = readPositiveIntEnv('ATM_ONEFILE_EXTRACT_LOCK_POLL_MS', 50);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isExtractedRootReady(cacheRoot)) {
      return;
    }
    if (!existsSync(lockRoot) && tryAcquireExtractionLock(lockRoot)) {
      try {
        if (!isExtractedRootReady(cacheRoot)) {
          extractPayload(cacheRoot);
        }
        return;
      } finally {
        releaseExtractionLock(lockRoot);
      }
    }
    sleepMs(pollMs);
  }
  throw new Error(\`Timed out waiting for ATM onefile extraction lock for payload \${payloadSha256}.\`);
}

function ensureExtractedRoot() {
  const cacheRoot = path.join(resolveCacheBaseRoot(), payloadSha256);
  const lockRoot = extractionLockRoot(cacheRoot);
  if (isExtractedRootReady(cacheRoot)) {
    return cacheRoot;
  }
  mkdirSync(path.dirname(cacheRoot), { recursive: true });
  if (tryAcquireExtractionLock(lockRoot)) {
    try {
      if (!isExtractedRootReady(cacheRoot)) {
        extractPayload(cacheRoot);
      }
    } finally {
      releaseExtractionLock(lockRoot);
    }
  } else {
    waitForExtractedRoot(cacheRoot);
  }
  return cacheRoot;
}

function firstPositionalCommand(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (arg.startsWith('--')) {
      if (arg === '--cwd') {
        index += 1;
      }
      continue;
    }
    return arg;
  }
  return null;
}

function run() {
  try {
    const extractedRoot = ensureExtractedRoot();
    const entrypoint = path.join(extractedRoot, 'atm.mjs');
    if (!existsSync(entrypoint)) {
      fail('Extracted payload is missing atm.mjs.');
      return;
    }
    const userArgs = process.argv.slice(2);
    const commandName = firstPositionalCommand(userArgs);
    const hasExplicitCwd = userArgs.includes('--cwd');
    const shouldUseExtractedFrameworkCwd = commandName === 'self-host-alpha' && hasExplicitCwd === false;
    const forwardedArgs = shouldUseExtractedFrameworkCwd
      ? [...userArgs, '--cwd', extractedRoot]
      : userArgs;
    const child = spawnSync(process.execPath, [entrypoint, ...forwardedArgs], {
      cwd: shouldUseExtractedFrameworkCwd ? extractedRoot : process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        ATM_ONEFILE_RUNTIME: '1',
        ATM_ONEFILE_LAUNCHER_PATH: path.resolve(process.argv[1] || ''),
        ATM_ONEFILE_PAYLOAD_SHA256: payloadSha256,
        ATM_ONEFILE_EXTRACTED_ROOT: extractedRoot
      },
      windowsHide: true
    });
    if (child.error) {
      fail(\`Failed to execute embedded ATM runtime: \${child.error.message}\`);
      return;
    }
    process.exitCode = child.status ?? 1;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

run();
`;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const result = buildOnefileRelease();
  console.log(`[build-onefile-release] built ${result.fileCount} files at ${path.relative(repoRoot, result.outputRoot)}`);
  finalizeBuildReleaseHygiene(repoRoot);
}
