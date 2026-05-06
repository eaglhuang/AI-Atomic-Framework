import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.mjs';
import { evaluateSeedSelfVerification, registryFilePath, validateRegistryDocumentAgainstSchema } from './registry-shared.mjs';

export function runVerify(argv) {
  const { options } = parseOptions(argv, 'verify');
  if (!options.self) {
    throw new CliError('ATM_CLI_USAGE', 'verify requires --self', { exitCode: 2 });
  }

  const schemaResult = validateRegistryDocumentAgainstSchema(options.cwd, registryFilePath, {
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
    cwd: options.cwd,
    messages,
    evidence: {
      registryPath: relativePathFrom(options.cwd, registryFilePath),
      atomId: verification.entry?.atomId,
      legacyPlanningId: verification.report?.legacyPlanningId?.actual,
      selfVerification: verification.report,
      validated: schemaResult.evidence.validated
    }
  });
}