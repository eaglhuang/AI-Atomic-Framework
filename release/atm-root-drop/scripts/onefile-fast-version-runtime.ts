/** Runtime fragment injected into the sealed onefile launcher. */
export function renderOnefileFastVersionRuntime(): string {
  return String.raw`function isVersionRequest(args) {
  return args[0] === '--version' || args[0] === '-v';
}

function writeFastVersionResult() {
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
    evidence: { frameworkVersion, runnerMode, runnerSourceDrift },
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
}`;
}
