import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDropReleaseRoot = path.join(repoRoot, 'release', 'atm-root-drop');
const onefileReleaseRoot = path.join(repoRoot, 'release', 'atm-onefile');

export function buildOnefileRelease(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const rootDropRoot = path.resolve(options.rootDropRoot ?? rootDropReleaseRoot);
  const outputRoot = path.resolve(options.outputRoot ?? onefileReleaseRoot);
  const outputFilePath = path.join(outputRoot, 'atm.mjs');

  if (!existsSync(rootDropRoot)) {
    buildRootDropRelease({ repositoryRoot });
  }

  const payloadFiles = collectPayloadFiles(rootDropRoot);
  const payload = {
    schemaVersion: 'atm.onefilePayload.v0.1',
    generatedAt: new Date().toISOString(),
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

  const manifestPath = path.join(outputRoot, 'release-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 'atm.onefileRelease.v0.1',
    generatedAt: payload.generatedAt,
    entrypoint: 'atm.mjs',
    payloadSha256,
    sourceRoot: 'release/atm-root-drop',
    fileCount: payloadFiles.length
  }, null, 2)}\n`, 'utf8');

  const readmePath = path.join(outputRoot, 'README.onefile.md');
  writeFileSync(readmePath, `${[
    '# ATM One-File Release',
    '',
    'This artifact is a single-file ATM launcher with embedded payload.',
    '',
    '## Entry',
    '',
    '`node atm.mjs next --json`',
    '',
    '## Prompt',
    '',
    'Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.'
  ].join('\n')}\n`, 'utf8');

  return {
    outputRoot,
    outputFilePath,
    manifestPath,
    payloadSha256,
    fileCount: payloadFiles.length
  };
}

function collectPayloadFiles(root) {
  const files = [];
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

function walkFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(absolutePath);
    }
    return [absolutePath];
  });
}

function renderOnefileRuntime({ payloadBase64, payloadSha256 }) {
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

function extractPayload(cacheRoot) {
  const payload = decodePayload();
  const stagingRoot = \`\${cacheRoot}.staging-\${process.pid}\`;
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
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
}

function ensureExtractedRoot() {
  const cacheRoot = path.join(os.tmpdir(), 'atm-onefile-cache', payloadSha256);
  const markerPath = path.join(cacheRoot, '.payload-ready.json');
  if (!existsSync(markerPath)) {
    extractPayload(cacheRoot);
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
}
