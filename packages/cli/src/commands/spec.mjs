import { CliError, parseOptions } from './shared.mjs';
import { validateAtomicSpecFileAgainstSchema } from './spec-shared.mjs';

export function runSpec(argv) {
  const { options } = parseOptions(argv, 'spec');
  if (!options.validate) {
    throw new CliError('ATM_CLI_USAGE', 'spec requires --validate <path>', { exitCode: 2 });
  }

  return validateAtomicSpecFileAgainstSchema(options.cwd, options.validate, {
    commandName: 'spec',
    successCode: 'ATM_SPEC_VALIDATE_OK',
    successText: 'Atomic spec validated against JSON Schema.'
  });
}