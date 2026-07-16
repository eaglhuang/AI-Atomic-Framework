import { runValidatorsCli } from './run-validators/implementation.ts';

process.exitCode = await runValidatorsCli();
