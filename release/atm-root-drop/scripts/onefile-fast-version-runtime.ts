import { assertNoRuntimeFilePrefixCollisions, isRuntimePackageVersion, runtimeIdentityReadLimits, verifyRuntimeBuildIdentity } from '../packages/cli/src/commands/shared/runtime-build-identity-verifier.ts';

/** Runtime fragment injected into the sealed onefile launcher. */
export function renderOnefileFastVersionRuntime(): string {
  return `const runtimeIdentityReadLimits = ${JSON.stringify(runtimeIdentityReadLimits)};
${isRuntimePackageVersion.toString()}
${assertNoRuntimeFilePrefixCollisions.toString()}
${verifyRuntimeBuildIdentity.toString()}
` + String.raw`function isVersionRequest(args) {
  return args[0] === '--version' || args[0] === '-v';
}

function writeFastVersionResult() {
  const runtimeBuildIdentity = readFastVersionBuildIdentity();
  const launcherPath = path.resolve(process.argv[1] || 'atm.mjs');
  const runnerSourceDrift = {
    schemaId: 'atm.runnerSourceDrift.v1',
    entrypoint: launcherPath,
    frozenEntrypoint: true,
    runnerPath: launcherPath,
    runnerMtime: null,
    newestSourceMtime: null,
    sourceSeal: { present: true, valid: true, digest: 'sha256:' + payloadSha256 },
    syncRequired: false,
    advisory: 'Standalone onefile runner is sealed to its embedded payload.',
    syncCommand: null
  };
  const runnerMode = {
    schemaId: 'atm.runnerMode.v1',
    mode: 'frozen',
    entrypoint: launcherPath,
    sourceDrift: runnerSourceDrift,
    normalGovernanceCommand: 'node atm.mjs ...',
    sourceFirstCommand: null,
    sourceFirstOnlyWhen: null,
    syncCommand: null,
    frozenRunnerSources: [launcherPath],
    guidance: 'This standalone onefile runner is sealed to its embedded payload.'
  };
  const result = {
    ok: true,
    command: 'version',
    mode: 'standalone',
    cwd: process.cwd(),
    messages: [{ level: 'info', code: 'ATM_CLI_VERSION', text: 'ATM framework version ' + frameworkVersion + '.', data: {} }],
    evidence: { frameworkVersion, runnerMode, runnerSourceDrift, runtimeBuildIdentity },
    nextAction: null,
    taskIntent: null,
    userNotice: null,
    runnerMode,
    frameworkReport: null,
    frameworkClaim: null,
    evidenceSummary: null,
    guardReport: null,
    taskflowReadiness: null,
    commitBundle: null,
    skillGrowth: null,
    laneSession: null,
    severity: 'success',
    exitCode: 0,
    blocking: false,
    diagnostics: { errorCodes: [], warningCodes: [], infoCodes: ['ATM_CLI_VERSION'] }
  };
  process.stdout.write(JSON.stringify(result) + '\n');
}

function isCanonicalPayloadBase64(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return !(value.endsWith('==') && (alphabet.indexOf(value.at(-3)) & 15) !== 0)
    && !(value.endsWith('=') && !value.endsWith('==') && (alphabet.indexOf(value.at(-2)) & 3) !== 0);
}

function readFastVersionBuildIdentity() {
  // Verify only embedded bytes. No extraction, filesystem reads, CLI imports,
  // ancestor package metadata or environment-supplied provenance is involved.
  if (typeof payloadBase64 !== 'string' || payloadBase64.length > Math.ceil(16 * 1024 * 1024 / 3) * 4) throw new Error('Onefile compressed payload budget exceeded.');
  if (!isCanonicalPayloadBase64(payloadBase64)) throw new Error('Invalid compressed payload encoding.');
  const compressedBytes = payloadBase64.length / 4 * 3 - (payloadBase64.endsWith('==') ? 2 : payloadBase64.endsWith('=') ? 1 : 0);
  if (compressedBytes > 16 * 1024 * 1024) throw new Error('Onefile compressed payload budget exceeded.');
  const payload = decodePayload(128 * 1024 * 1024);
  const base = { schemaId: 'atm.runtimeIdentity.v1', packageName: '@ai-atomic-framework/cli', executionMode: 'distribution', version: isRuntimePackageVersion(frameworkVersion) ? frameworkVersion : null,
    sourceCommit: null, sourceDigest: null, buildId: null };
  try {
    if (payload?.schemaVersion !== 'atm.onefilePayload.v0.1' || !Array.isArray(payload.files) || payload.files.length > 4096) throw new Error('Invalid payload members.');
    const members = new Map();
    let totalBytes = 0;
    for (const file of payload.files) {
      if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.path !== 'string' || file.path.length > runtimeIdentityReadLimits.maxPathCharacters
        || /^[A-Za-z]:/.test(file.path) || file.path.includes('\\') || file.path.includes('\0') || file.path.split('/').some(part => !part || part === '.' || part === '..')
        || members.has(file.path) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 511
        || typeof file.dataBase64 !== 'string' || file.dataBase64.length > Math.ceil(runtimeIdentityReadLimits.maxMemberBytes / 3) * 4
        || !isCanonicalPayloadBase64(file.dataBase64)) throw new Error('Invalid payload member.');
      const bytes = file.dataBase64.length / 4 * 3 - (file.dataBase64.endsWith('==') ? 2 : file.dataBase64.endsWith('=') ? 1 : 0);
      if (bytes > runtimeIdentityReadLimits.maxMemberBytes || (totalBytes += bytes) > runtimeIdentityReadLimits.maxTotalBytes) throw new Error('Payload member byte budget exceeded.');
      members.set(file.path, { encoded: file.dataBase64, bytes });
    }
    assertNoRuntimeFilePrefixCollisions(members.keys());
    // These are the real metadata caller locations for version and doctor.
    // A nearer package boundary would stop the filesystem resolver before it
    // reaches packages/cli/package.json, even if the inner JSON is malformed.
    for (const entry of ['atm.js', 'commands/doctor/run-doctor.js']) {
      const parts = entry.split('/');
      for (let count = 0; count < parts.length; count++) {
        const directory = parts.slice(0, count).join('/');
        const boundary = 'packages/cli/dist/' + (directory ? directory + '/' : '') + 'package.json';
        if (members.has(boundary) || [...members.keys()].some(member => member.startsWith(boundary + '/'))) throw new Error('Unexpected embedded package boundary.');
      }
    }
    const read = (relative, limit) => {
      const member = members.get(relative);
      if (!member || member.bytes > limit) throw new Error('Missing or oversized payload member.');
      const bytes = Buffer.from(member.encoded, 'base64');
      if (bytes.toString('base64') !== member.encoded) throw new Error('Noncanonical base64 member.');
      return bytes;
    };
    const identityPath = 'packages/cli/dist/build-identity.json';
    if (!members.has(identityPath)) return { ...base, status: 'unavailable' };
    const pkg = JSON.parse(read('packages/cli/package.json', 1024 * 1024).toString('utf8'));
    if (!pkg || Array.isArray(pkg) || pkg.name !== base.packageName || pkg.version !== frameworkVersion) throw new Error('Embedded package mismatch.');
    const identity = JSON.parse(read(identityPath, 1024 * 1024).toString('utf8'));
    const hash = value => createHash('sha256').update(value).digest('hex');
    const verified = verifyRuntimeBuildIdentity(identity, pkg.version, 'atm.js', (relative, remaining) => {
      const bytes = read('packages/cli/dist/' + relative, Math.min(runtimeIdentityReadLimits.maxMemberBytes, remaining));
      return { digest: hash(bytes), bytes: bytes.length };
    }, hash);
    return { ...base, status: 'verified', ...verified };
  } catch {
    return { ...base, status: 'mismatch' };
  }
}`;
}
