import path from 'node:path';
import { existsSync } from 'node:fs';
import { configPathFor, makeResult, message, parseOptions, readJsonFile, relativePathFrom } from './shared.mjs';
import { evaluateSeedGovernance, frameworkRepoRoot, registryFilePath, validateRegistryDocumentAgainstSchema } from './registry-shared.mjs';

export function runStatus(argv) {
  const { options } = parseOptions(argv, 'status');
  const configPath = configPathFor(options.cwd);

  if (!existsSync(configPath)) {
    if (path.resolve(options.cwd) === frameworkRepoRoot && existsSync(registryFilePath)) {
      const registryValidation = validateRegistryDocumentAgainstSchema(options.cwd, registryFilePath, {
        commandName: 'status',
        successCode: 'ATM_STATUS_REGISTRY_OK',
        successText: 'Framework registry is valid.'
      });
      if (!registryValidation.ok) {
        return registryValidation;
      }

      const governance = evaluateSeedGovernance();
      return makeResult({
        ok: governance.ok,
        command: 'status',
        cwd: options.cwd,
        messages: [
          ...registryValidation.messages,
          governance.ok
            ? message('info', 'ATM_STATUS_PHASE_B1_COMPLETE', 'ATM framework Phase B1 is complete.')
            : message('error', 'ATM_STATUS_PHASE_B1_INCOMPLETE', 'ATM framework Phase B1 is not complete yet.', { issues: governance.verificationIssues })
        ],
        evidence: {
          configPath: relativePathFrom(options.cwd, configPath),
          initialized: false,
          frameworkRepository: true,
          frameworkPhase: governance.frameworkPhase,
          registryPath: relativePathFrom(options.cwd, registryFilePath),
          atomId: governance.atomId,
          atomStatus: governance.atomStatus,
          governanceTier: governance.governanceTier,
          legacyPlanningId: governance.legacyPlanningId,
          governedByLegacyPlanningId: governance.governedByLegacyPlanningId,
          selfVerificationOk: governance.selfVerificationOk
        }
      });
    }

    return makeResult({
      ok: false,
      command: 'status',
      cwd: options.cwd,
      messages: [message('error', 'ATM_CONFIG_MISSING', 'ATM config is missing. Run atm init first.')],
      evidence: {
        configPath: relativePathFrom(options.cwd, configPath),
        initialized: false
      }
    });
  }

  const config = readJsonFile(configPath, 'ATM_CONFIG_MISSING');
  const schemaVersionOk = config.schemaVersion === 'atm.config.v0.1';
  const adapterMode = config.adapter?.mode ?? 'unknown';
  const adapterImplemented = config.adapter?.implemented === true;
  const adoptedProfile = config.adoption?.profile ?? null;
  const projectProbePath = config.adoption?.projectProbePath
    ? `${options.cwd}/${config.adoption.projectProbePath}`.replace(/\\/g, '/')
    : null;
  const projectProbe = projectProbePath && existsSync(projectProbePath)
    ? readJsonFile(projectProbePath, 'ATM_PROJECT_PROBE_MISSING')
    : null;

  return makeResult({
    ok: schemaVersionOk,
    command: 'status',
    cwd: options.cwd,
    messages: [
      schemaVersionOk
        ? message('info', 'ATM_STATUS_READY', 'ATM standalone config is ready.')
        : message('error', 'ATM_CONFIG_UNSUPPORTED_VERSION', 'ATM config schemaVersion is not supported.', { schemaVersion: config.schemaVersion })
    ],
    evidence: {
      configPath: relativePathFrom(options.cwd, configPath),
      initialized: true,
      schemaVersion: config.schemaVersion,
      adapterMode,
      adapterImplemented,
      standaloneMode: adapterMode === 'standalone' && !adapterImplemented,
      adoptedProfile,
      projectProbePath: config.adoption?.projectProbePath ?? null,
      repositoryKind: projectProbe?.repositoryKind ?? null,
      recommendedPrompt: projectProbe?.recommendedPrompt ?? null
    }
  });
}