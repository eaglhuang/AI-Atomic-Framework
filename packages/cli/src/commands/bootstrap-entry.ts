import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runInit } from './init.ts';
import { message } from './shared.ts';

const defaultBootstrapTaskTitle = 'Bootstrap ATM in this repository';

export async function runBootstrap(argv: any) {
  const hasTask = Array.isArray(argv) && argv.includes('--task');
  const effectiveArgs = hasTask ? argv : [...argv, '--task', defaultBootstrapTaskTitle];
  const result = await runInit([...effectiveArgs, '--adopt', 'default']);
  const created = Array.isArray(result.evidence?.created) ? result.evidence.created : [];
  const bootstrapCreated = created.length > 0;

  return {
    ...result,
    command: 'bootstrap',
    evidence: {
      ...result.evidence,
      pinnedRunner: readPinnedRunnerMetadata(result.cwd)
    },
    messages: [
      bootstrapCreated
        ? message('info', 'ATM_BOOTSTRAP_CREATED', 'ATM default bootstrap pack created.')
        : message('info', 'ATM_BOOTSTRAP_READY', 'ATM default bootstrap pack already exists; no files were changed.')
    ]
  };
}

function readPinnedRunnerMetadata(cwd: string) {
  const metadataPath = path.join(cwd, '.atm', 'runtime', 'pinned-runner.json');
  if (!existsSync(metadataPath)) {
    return null;
  }
  return JSON.parse(readFileSync(metadataPath, 'utf8'));
}
