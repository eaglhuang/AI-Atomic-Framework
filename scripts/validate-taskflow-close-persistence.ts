// Mandatory Product CI coverage, with a separate budget from the generic CLI sweep.
import '../packages/cli/src/commands/taskflow/__tests__/close-atomic-persistence.spec.ts';
import { runPersistenceMatrix, runRecoveryPersistenceMatrix, runConcurrentCloseMatrix } from '../packages/cli/src/commands/taskflow/__tests__/close-persistence-matrix.ts';
await runPersistenceMatrix('before');
await runPersistenceMatrix('after');
await runRecoveryPersistenceMatrix();
await runConcurrentCloseMatrix();
console.log('close persistence: 70 crash-boundary cases and concurrent real closes passed');
