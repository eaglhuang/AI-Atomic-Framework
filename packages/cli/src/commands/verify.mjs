import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.mjs';
import { evaluateSeedSelfVerification, registryFilePath, validateRegistryDocumentAgainstSchema } from './registry-shared.mjs';
import { defaultNeutralityPolicyRelativePath, scanNeutralityRepository } from '../../../plugin-rule-guard/src/neutrality-scanner.mjs';

export function runVerify(argv) {
  const { options } = parseOptions(argv, 'verify');
  if (!options.self && !options.neutrality) {
    throw new CliError('ATM_CLI_USAGE', 'verify requires --self or --neutrality', { exitCode: 2 });
  }

  if (options.neutrality) {
    return runNeutralityVerify(options.cwd);
  }

  return runSelfVerify(options.cwd);
}

function runSelfVerify(cwd) {
  const schemaResult = validateRegistryDocumentAgainstSchema(cwd, registryFilePath, {
    commandName: 'verify',
    successCode: 'ATM_VERIFY_REGISTRY_SCHEMA_OK',
    successText: 'Atomic registry validated against JSON Schema.'
  });

  if (!schemaResult.ok) {
    return schemaResult;
  }

  const verification = evaluateSeedSelfVerification();
  const messages = [
    ...schemaResult.messages,
    verification.ok
      ? message('info', 'ATM_VERIFY_SELF_OK', 'Seed self-verification hashes match the committed registry entry.')
      : message('error', 'ATM_VERIFY_SELF_DRIFT', 'Seed self-verification detected registry drift.', { issues: verification.issues })
  ];

  return makeResult({
    ok: verification.ok,
    command: 'verify',
    cwd,
    messages,
    evidence: {
      registryPath: relativePathFrom(cwd, registryFilePath),
      atomId: verification.entry?.atomId,
      legacyPlanningId: verification.report?.legacyPlanningId?.actual,
      selfVerification: verification.report,
      validated: schemaResult.evidence.validated
    }
  });
}

function runNeutralityVerify(cwd) {
  const report = scanNeutralityRepository({
    repositoryRoot: cwd,
    policyPath: defaultNeutralityPolicyRelativePath
  });
  const messages = report.ok
    ? [message('info', 'ATM_VERIFY_NEUTRALITY_OK', 'Neutrality scan passed across protected framework surfaces.', { scannedFiles: report.totals.scannedFiles })]
    : [message('error', 'ATM_VERIFY_NEUTRALITY_FAILED', 'Neutrality scan found adopter-specific references in protected framework surfaces.', { violations: report.totals.violations })];

  return makeResult({
    ok: report.ok,
    command: 'verify',
    cwd,
    messages,
    evidence: {
      atomId: report.atomId,
      legacyPlanningId: report.legacyPlanningId,
      policyPath: report.policyPath,
      scannedFiles: report.totals.scannedFiles,
      termViolations: report.totals.termViolations,
      pathViolations: report.totals.pathViolations,
      violations: report.violations,
      validated: [report.policyPath]
    }
  });
}