import { execFileSync, spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.0.0-does-not-exist', '--record-blocked'];
const output = execFileSync(npm, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const proof = JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
assert.equal(proof.schemaId, 'atm.publicNpmInstallProof.v1');
assert.equal(proof.status, 'blocked');
assert.equal(proof.publicRegistry, false);
assert.equal(proof.usedWorkspaceLink, undefined);

const validatorSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../../scripts/validate-public-npm-install.ts', import.meta.url), 'utf8'));
assert.match(validatorSource, /resolvePublishedLatest\(packageName\)/, 'public npm validator must resolve the registry latest tag when no version is supplied');
assert.match(validatorSource, /dist-tags\.latest/, 'public npm validator must derive its default from the registry dist-tag');
assert.match(validatorSource, /\['dist\.tarball'\]/, 'validator must accept npm view flat dist.tarball metadata');
assert.match(validatorSource, /shell: process\.platform === 'win32'/, 'validator must execute Windows .cmd bins through the shell');
assert.match(validatorSource, /dist\.unpackedSize/, 'validator must read public unpacked size metadata');
assert.match(validatorSource, /maxPackedBytes/, 'validator must enforce the declared artifact byte budget');
assert.match(validatorSource, /maxPackedEntries/, 'validator must enforce the declared artifact entry budget');
assert.match(validatorSource, /runSmoke\(tarball/, 'public npm validator must execute the installed tarball smoke matrix');
assert.match(validatorSource, /versionOnlySmoke: false/, 'public npm validator must reject version-only evidence');
assert.match(validatorSource, /commandMatrixComplete/, 'public npm validator must report complete command-matrix coverage');
assert.match(validatorSource, /atm-chart-render/, 'public npm validator must exercise chart rendering');
assert.match(validatorSource, /atm-chart-verify/, 'public npm validator must exercise chart verification');
assert.match(validatorSource, /requiredSuccessCommandFailures/, 'public npm validator must report required command failures');
assert.match(validatorSource, /coreWorkflowPassed/, 'public npm validator must report core workflow status');

const candidateValidatorSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../../scripts/validate-candidate-npm-install.ts', import.meta.url), 'utf8'));
assert.match(candidateValidatorSource, /--candidate-tarball/, 'candidate validator must accept an explicit tarball');
assert.match(candidateValidatorSource, /atm\.candidateNpmInstallProof\.v1/, 'candidate validator must use a separate receipt schema');
assert.match(candidateValidatorSource, /versionOnlySmoke: false/, 'candidate validator must reject version-only evidence');
assert.match(candidateValidatorSource, /moduleResolutionFailures/, 'candidate validator must report module-resolution failures');
assert.match(candidateValidatorSource, /usedWorkspaceLink: false/, 'candidate validator must prove a tarball install rather than a workspace link');
assert.match(candidateValidatorSource, /atm-chart-render/, 'candidate validator must exercise chart rendering');
assert.match(candidateValidatorSource, /atm-chart-verify/, 'candidate validator must exercise chart verification');
assert.match(candidateValidatorSource, /requiredSuccessCommands/, 'candidate validator must declare required core workflow commands');
assert.match(candidateValidatorSource, /requiredSuccessCommandFailures/, 'candidate validator must fail closed on required command failures');
assert.match(candidateValidatorSource, /coreWorkflowPassed/, 'candidate validator must report core workflow status');
assert.match(candidateValidatorSource, /candidateOnly: true/, 'candidate receipt must remain candidate-only');
assert.match(candidateValidatorSource, /publicRegistry: false/, 'candidate receipt must not claim registry evidence');
assert.match(candidateValidatorSource, /readExplicitTarballMetadata/, 'explicit tarball metadata must be archive-derived');
assert.match(candidateValidatorSource, /unpackedSize: files\.reduce/, 'explicit tarball metadata must record unpacked bytes');
assert.match(candidateValidatorSource, /missing package\/package\.json/, 'explicit tarball metadata must fail closed without package manifest');

const { resolveBootstrapCommandPrefix } = await import('../../packages/plugin-governance-local/src/bootstrap/bootstrap/bootstrap-support.ts');
assert.equal(resolveBootstrapCommandPrefix('source-unavailable'), 'npm exec -- atm');
for (const status of ['installed', 'replaced', 'unchanged', 'skipped-existing-different'] as const) {
  assert.equal(resolveBootstrapCommandPrefix(status), 'node atm.mjs', `${status} must keep the pinned-runner command`);
}

const live = execFileSync(npm, ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.1.0', '--record-blocked', '--measurement-runs', '1'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const liveProof = JSON.parse(live.trim().split(/\r?\n/).at(-1)!);
assert.equal(liveProof.validation.cleanConsumer, true);
assert.equal(liveProof.validation.usedWorkspaceLink, false);
assert.equal(liveProof.validation.versionOnlySmoke, false);
assert.equal(liveProof.validation.commandMatrixComplete, true);
assert.deepEqual(liveProof.validation.requiredSuccessCommands, ['version', 'doctor', 'bootstrap', 'atm-chart-render', 'atm-chart-verify', 'create']);
assert.equal(liveProof.validation.moduleResolutionFailures, 0);
assert.equal(liveProof.validation.allCommandsExecuted, true);
if (liveProof.status === 'verified') {
  assert.equal(liveProof.validation.coreWorkflowPassed, true);
  assert.equal(liveProof.validation.passed, true);
} else {
  assert.equal(liveProof.status, 'blocked');
  assert.equal(liveProof.validation.coreWorkflowPassed, false);
  assert.equal(liveProof.validation.passed, false);
  assert.ok(liveProof.validation.requiredSuccessCommandFailures.length > 0);
}

const oversized = execFileSync(npm, ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.1.0-beta.4', '--record-blocked'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const oversizedProof = JSON.parse(oversized.trim().split(/\r?\n/).at(-1)!);
assert.equal(oversizedProof.status, 'blocked');
assert.match(String(oversizedProof.error ?? oversizedProof.blockedReason), /budget/i, 'over-budget public package must fail closed');

let failedClosed = false;
try { execFileSync(npm, args.slice(0, -1), { encoding: 'utf8', windowsHide: true, stdio: 'pipe', shell: process.platform === 'win32' }); } catch { failedClosed = true; }
assert.equal(failedClosed, true, 'unpublished package must fail closed without --record-blocked');

// A registry smoke cannot prove a not-yet-published candidate. Pack the local
// runtime, install it into an isolated consumer, and exercise the first
// post-bootstrap chart lifecycle so missing data assets cannot hide behind a
// version-only or module-resolution check.
const localSmokeRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-public-runtime-chart-'));
try {
  // --ignore-scripts also skips prepack, so a fresh checkout would pack the
  // tracked subset of dist rather than the package that would ship. Build the
  // CLI closure first.
  const packageDirs = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, 'packages', entry.name, 'package.json')))
    .map((entry) => path.join(root, 'packages', entry.name, 'dist'));
  const workspaceBuildReady = packageDirs.every((distRoot) => existsSync(distRoot));
  const buildScript = path.join(root, 'scripts', 'build-package-dist.ts');
  if (workspaceBuildReady) {
    execFileSync(process.execPath, ['--strip-types', buildScript, '--package', 'packages/plugin-governance-local'], {
      cwd: root, encoding: 'utf8', windowsHide: true
    });
    execFileSync(process.execPath, ['--strip-types', buildScript, '--package', 'packages/cli'], {
      cwd: root, encoding: 'utf8', windowsHide: true
    });
  } else {
    execFileSync(process.execPath, ['--strip-types', buildScript], {
      cwd: root, encoding: 'utf8', windowsHide: true
    });
  }
  const packed = JSON.parse(execFileSync(npm, [
    'pack', '--workspace', '@ai-atomic-framework/cli', '--ignore-scripts', '--pack-destination', localSmokeRoot,
    '--json', '--loglevel', 'silent'
  ], { cwd: root, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }).trim());
  const tarball = path.join(localSmokeRoot, packed[0].filename);
  const consumer = path.join(localSmokeRoot, 'consumer');
  const adopter = path.join(consumer, 'adopter');
  mkdirSync(adopter, { recursive: true });
  execFileSync(npm, ['install', '--ignore-scripts', '--no-save', '--prefix', consumer, tarball], {
    cwd: localSmokeRoot, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32'
  });
  const entrypoint = path.join(consumer, 'node_modules', '@ai-atomic-framework', 'cli', 'dist', 'npm-runtime', 'atm.mjs');
  assert.ok(existsSync(entrypoint), 'local candidate install must expose the frozen atm entrypoint');
  const runAtmAt = (cwd: string, ...args: string[]) => {
    const result = spawnSync(process.execPath, [entrypoint, ...args], { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `local candidate ${args.join(' ')} failed: ${result.stdout}${result.stderr}`);
    return `${result.stdout}${result.stderr}`;
  };
  const runAtm = (...args: string[]) => runAtmAt(adopter, ...args);

  // Exercise the published entrypoint's suggested command in a genuinely fresh
  // consumer. A smoke that only proves `next` itself starts can miss a dead-end
  // command that assumes a repository-local atm.mjs or an existing npm script.
  const firstUse = path.join(localSmokeRoot, 'first-use-consumer');
  mkdirSync(firstUse, { recursive: true });
  execFileSync(npm, ['install', '--ignore-scripts', '--prefix', firstUse, tarball], {
    cwd: localSmokeRoot, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32'
  });
  const runNpmExecAt = (...args: string[]) => spawnSync(npm, ['exec', '--', 'atm', ...args], {
    cwd: firstUse, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32'
  });

  const tokenizeCommand = (command: string) => [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  const runGeneratedNpmCommand = (command: string) => {
    const tokens = tokenizeCommand(command);
    assert.equal(tokens[0], 'npm', `generated first-use command must start with npm: ${command}`);
    return spawnSync(npm, tokens.slice(1), {
      cwd: firstUse, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32'
    });
  };

  const bootstrapNext = runNpmExecAt('next', '--json');
  assert.equal(bootstrapNext.status, 1, `fresh npm install should request bootstrap: ${bootstrapNext.stdout}${bootstrapNext.stderr}`);
  const lifecycle: Array<{ command: string; status: number }> = [
    { command: 'npm exec -- atm next --json', status: bootstrapNext.status ?? -1 }
  ];
  const bootstrapNextJson = JSON.parse(`${bootstrapNext.stdout}${bootstrapNext.stderr}`);
  assert.equal(bootstrapNextJson.evidence.runnerMode.mode, 'npm-package');
  assert.match(bootstrapNextJson.evidence.nextAction.command, /^npm exec -- atm bootstrap /);
  const bootstrap = runGeneratedNpmCommand(bootstrapNextJson.evidence.nextAction.command);
  lifecycle.push({ command: bootstrapNextJson.evidence.nextAction.command, status: bootstrap.status ?? -1 });
  assert.equal(bootstrap.status, 0, `generated bootstrap command failed: ${bootstrap.stdout}${bootstrap.stderr}`);

  const agents = readFileSync(path.join(firstUse, 'AGENTS.md'), 'utf8');
  const generatedNextMatch = agents.match(/then run `([^`]+)` from the repository root before task work/);
  assert.ok(generatedNextMatch, 'bootstrap-generated AGENTS.md must contain an executable first-use next command');
  const generatedNextCommand = generatedNextMatch[1].replace('<current user prompt>', 'public npm first-use contract');
  assert.match(generatedNextCommand, /^npm exec -- atm next --prompt /);
  const generatedNext = runGeneratedNpmCommand(generatedNextCommand);
  assert.ok(generatedNext.status === 0 || generatedNext.status === 1, `generated AGENTS command failed to start ATM: ${generatedNext.stdout}${generatedNext.stderr}`);
  const generatedNextJson = JSON.parse(`${generatedNext.stdout}${generatedNext.stderr}`);
  lifecycle.push({ command: generatedNextCommand, status: generatedNext.status ?? -1 });
  assert.equal(generatedNextJson.evidence.runnerMode.mode, 'npm-package');
  assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(`${generatedNext.stdout}${generatedNext.stderr}`));
  let current = generatedNextJson;
  let ready = generatedNext.status === 0 && ['ready', 'no-work'].includes(current.evidence?.nextAction?.status);
  for (let step = 0; !ready && step < 5; step += 1) {
    const action = current.evidence?.nextAction?.command;
    assert.equal(typeof action, 'string', `next response must provide an executable action before ready: ${JSON.stringify(current)}`);
    const actionResult = runGeneratedNpmCommand(action);
    lifecycle.push({ command: action, status: actionResult.status ?? -1 });
    assert.equal(actionResult.status, 0, `generated first-use action failed (${action}): ${actionResult.stdout}${actionResult.stderr}`);
    assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(`${actionResult.stdout}${actionResult.stderr}`));
    const nextResult = runNpmExecAt('next', '--json');
    lifecycle.push({ command: 'npm exec -- atm next --json', status: nextResult.status ?? -1 });
    assert.ok(nextResult.status === 0 || nextResult.status === 1, `next failed before ready: ${nextResult.stdout}${nextResult.stderr}`);
    current = JSON.parse(`${nextResult.stdout}${nextResult.stderr}`);
    assert.equal(current.evidence.runnerMode.mode, 'npm-package');
    assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(`${nextResult.stdout}${nextResult.stderr}`));
    ready = nextResult.status === 0 && ['ready', 'no-work'].includes(current.evidence?.nextAction?.status);
  }
  assert.ok(ready, `generated npm first-use actions did not reach ready/no-work within five steps: ${JSON.stringify(lifecycle)}`);
  const readyCommand = current.evidence?.nextAction?.command;
  assert.equal(readyCommand, 'npm test --if-present', `ready lifecycle must expose the next normal action: ${JSON.stringify(current)}`);
  const readyAction = runGeneratedNpmCommand(readyCommand);
  lifecycle.push({ command: readyCommand, status: readyAction.status ?? -1 });
  assert.equal(readyAction.status, 0, `generated ready action failed: ${readyAction.stdout}${readyAction.stderr}`);
  assert.ok(lifecycle.length >= 4, `first-use receipt must include generated command chain: ${JSON.stringify(lifecycle)}`);
  console.log(`[public-npm-install-contract:first-use-chain] ${JSON.stringify(lifecycle)}`);

  const { buildPromptGuidanceNextResult, buildPromptRequiredNextResult } = await import('../../packages/cli/src/commands/next/prompt-guidance-result.ts');
  const { createDeterministicTaskIntent } = await import('../../packages/cli/src/commands/next/route-resolution/intent.ts');
  const { inspectIntegrationBootstrap } = await import('../../packages/cli/src/commands/integration.ts');
  const { inspectRuntimeAdapterReadiness } = await import('../../packages/cli/src/commands/runtime-adapter-readiness.ts');
  const routeContext = {
    cwd: root,
    commandPrefix: 'npm exec -- atm',
    integrationBootstrap: inspectIntegrationBootstrap(root),
    runtimeAdapterReadiness: inspectRuntimeAdapterReadiness(root)
  };
  const guidanceFor = (prompt: string) => buildPromptGuidanceNextResult({
    ...routeContext,
    taskIntent: createDeterministicTaskIntent(prompt)
  })!;
  const journalingRoute = guidanceFor('請把 ATM friction 寫入 backlog，並稽核已完成治理計畫');
  const journalingActionCommand = (journalingRoute.evidence as any).nextAction.command as string;
  assert.equal((journalingRoute.evidence as any).nextAction.status, 'journaling-ready');
  assert.match(journalingActionCommand, /^npm exec -- atm guide first-layer --json$/);
  const journalingAction = runGeneratedNpmCommand(journalingActionCommand);
  assert.equal(journalingAction.status, 0, `generated journaling command failed: ${journalingAction.stdout}${journalingAction.stderr}`);

  const quickfixRoute = guidanceFor('Quick fix a typo in src/example.ts');
  const quickfixAction = (quickfixRoute.evidence as any).nextAction;
  assert.equal(quickfixAction.status, 'quickfix-ready');
  assert.match(quickfixAction.command, /^npm exec -- atm next --claim /);
  assert.ok(quickfixAction.allowedCommands.every((command: string) => command.startsWith('npm exec -- atm ')));
  const quickfixCommand = quickfixAction.command.replace('<id>', 'public-npm-contract');
  const quickfixCommandResult = runGeneratedNpmCommand(quickfixCommand);
  assert.ok(quickfixCommandResult.status === 0 || quickfixCommandResult.status === 1, `generated quickfix command did not invoke ATM: ${quickfixCommandResult.stdout}${quickfixCommandResult.stderr}`);
  assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(`${quickfixCommandResult.stdout}${quickfixCommandResult.stderr}`));

  const frameworkRoute = guidanceFor('Improve ATM framework routing');
  const frameworkAction = (frameworkRoute.evidence as any).nextAction;
  assert.equal(frameworkAction.status, 'framework-temp-claim-required');
  assert.match(frameworkAction.command, /^node atm\.mjs framework-mode claim /);
  assert.ok(frameworkAction.allowedCommands.every((command: string) => command.startsWith('node atm.mjs ')));
  const frameworkStatusTokens = tokenizeCommand(frameworkAction.allowedCommands[1]);
  assert.equal(frameworkStatusTokens[0], 'node');
  const frameworkStatusAction = spawnSync(process.execPath, [path.join(root, frameworkStatusTokens[1]), ...frameworkStatusTokens.slice(2)], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
  assert.equal(frameworkStatusAction.status, 0, `generated framework status command failed: ${frameworkStatusAction.stdout}${frameworkStatusAction.stderr}`);

  const promptRequiredRoute = buildPromptRequiredNextResult({
    ...routeContext,
    claimRequested: false,
    importedTaskQueue: {
      taskStorePath: '.atm/history/tasks', openTaskCount: 1, selectedTask: null, claimableTask: null, promptScope: null,
      tasks: [{ workItemId: 'TASK-SMOKE-0001', title: 'Prompt required smoke', status: 'open', closedAt: null,
        closedByActor: null, closurePacket: null, lastTransitionId: null, lastTransitionAt: null, taskPath: '.atm/history/tasks/TASK-SMOKE-0001.json',
        milestone: null, dependencies: [], format: 'json', sourcePlanPath: null, nearbyPlanPaths: [], scopePaths: [], targetRepo: null,
        planningRepo: null, allowPlanningMirror: false, planningReadOnlyPaths: [], planningMirrorPaths: [], targetAllowedFiles: [],
        closureAuthority: null, activeClaimActorId: null, activeClaimLaneSessionId: null, activeClaimIntent: null }]
    }
  });
  const promptRequiredAction = (promptRequiredRoute.evidence as any).nextAction;
  assert.equal(promptRequiredAction.status, 'prompt-required');
  assert.match(promptRequiredAction.command, /^npm exec -- atm next --prompt /);
  assert.ok(promptRequiredAction.allowedCommands.every((command: string) => command.startsWith('npm exec -- atm ')));
  const promptRequiredCommand = promptRequiredAction.command.replace('<current user prompt>', 'a bounded smoke task');
  const promptRequiredActionResult = runGeneratedNpmCommand(promptRequiredCommand);
  assert.ok(promptRequiredActionResult.status === 0 || promptRequiredActionResult.status === 1);
  assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(`${promptRequiredActionResult.stdout}${promptRequiredActionResult.stderr}`));

  runAtm('bootstrap', '--cwd', adopter, '--task', 'public runtime chart smoke', '--json');
  runAtm('atm-chart', 'render', '--cwd', adopter, '--json');
  runAtm('atm-chart', 'verify', '--cwd', adopter, '--json');
  const installedLayout = path.join(consumer, 'node_modules', '@ai-atomic-framework', 'cli', 'dist', 'npm-runtime', 'layout');
  for (const schemaPath of [
    'schemas/atomic-spec.schema.json'
  ]) {
    assert.ok(existsSync(path.join(installedLayout, schemaPath)), `local candidate runtime must carry ${schemaPath}`);
  }
  for (const schemaPath of [
    'schemas/agent-prompt.schema.json',
    'schemas/charter/charter-invariants.schema.json',
    'schemas/governance/default-guards.schema.json',
    'schemas/integrations/install-manifest.schema.json',
    'schemas/upgrade/upgrade-proposal.schema.json'
  ]) {
    assert.equal(existsSync(path.join(installedLayout, schemaPath)), false, `embedded chart schema must not be duplicated as ${schemaPath}`);
  }
  const runtimeManifest = JSON.parse(readFileSync(path.join(consumer, 'node_modules', '@ai-atomic-framework', 'cli', 'dist', 'npm-runtime', 'manifest.json'), 'utf8')) as {
    embeddedRuntimeAssets?: Array<{ path: string; kind: string; sha256: string }>;
  };
  assert.deepEqual(
    runtimeManifest.embeddedRuntimeAssets?.map((entry) => entry.path),
    [
      'schemas/agent-prompt.schema.json',
      'schemas/charter/charter-invariants.schema.json',
      'schemas/governance/default-guards.schema.json',
      'schemas/integrations/install-manifest.schema.json',
      'schemas/upgrade/upgrade-proposal.schema.json'
    ],
    'runtime manifest must enumerate logical embedded chart assets'
  );
  assert.ok(runtimeManifest.embeddedRuntimeAssets?.every((entry) => entry.kind === 'bundled-logical-asset' && /^sha256:[0-9a-f]{64}$/.test(entry.sha256)));
  const chart = readFileSync(path.join(adopter, '.atm', 'memory', 'atm-chart.md'), 'utf8');
  for (const schemaId of ['governance/default-guards', 'charter/charter-invariants', 'integrations/install-manifest', 'agent-prompt', 'upgrade/upgrade-proposal']) {
    assert.match(chart, new RegExp(schemaId.replace('/', '\\/')), `rendered ATMChart must record ${schemaId}`);
  }

  const explicitOutput = execFileSync(process.execPath, [
    '--strip-types', path.join(root, 'scripts', 'validate-candidate-npm-install.ts'),
    '--candidate-dir', path.join(root, 'packages', 'cli'), '--candidate-tarball', tarball,
    '--measurement-runs', '1', '--record-blocked'
  ], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false });
  const explicitProof = JSON.parse(explicitOutput.trim().split(/\r?\n/).at(-1)!);
  assert.equal(explicitProof.candidate.source, 'explicit-tarball');
  assert.equal(explicitProof.candidate.version, packed[0].version);
  assert.equal(explicitProof.candidate.unpackedBytes, packed[0].unpackedSize);
  assert.equal(explicitProof.candidate.entryCount, packed[0].files.length);
  assert.equal(explicitProof.candidate.files.length, packed[0].files.length);
  assert.ok(explicitProof.candidate.files.some((entry: { path?: string }) => entry.path === 'package/package.json'));
  assert.equal(explicitProof.validation.coreWorkflowPassed, true);

  const malformed = path.join(localSmokeRoot, 'malformed.tgz');
  writeFileSync(malformed, Buffer.from('not a gzip archive'));
  const malformedOutput = execFileSync(process.execPath, [
    '--strip-types', path.join(root, 'scripts', 'validate-candidate-npm-install.ts'),
    '--candidate-dir', path.join(root, 'packages', 'cli'), '--candidate-tarball', malformed,
    '--measurement-runs', '1', '--record-blocked'
  ], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false });
  const malformedProof = JSON.parse(malformedOutput.trim().split(/\r?\n/).at(-1)!);
  assert.equal(malformedProof.status, 'blocked');
  assert.match(String(malformedProof.error), /gzip archive/i);
} finally {
  rmSync(localSmokeRoot, { recursive: true, force: true });
}
console.log('[public-npm-install-contract] ok');
