import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

export function fail(text: string): void {
  console.error(`[task-import:${mode}] ${text}`);
  process.exitCode = 1;
}

export type FixturePaths = {
  samplePlan: string;
  npcPlan: string;
  singleCard: string;
  duplicatePlan: string;
  governanceTablePlan: string;
  chineseBootstrapPlan: string;
  dispatchMetadataCard: string;
  canonicalAtmBacklog: string;
};
