import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAtm } from './validate-cli/context.ts';
import { currentHelpSnapshot, helpSnapshotMatches, helpSnapshotDirectory, readHelpSnapshots } from './validate-cli/help-snapshots.ts';
import { formatAtmResultLine } from './lib/atm-result-line.ts';

async function main(): Promise<void> {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--only');
  const only = index >= 0 ? argv[index + 1] : undefined;
  const changed: string[] = [];
  let hint = '';
  let ok = true;
  try {
    const snapshots = readHelpSnapshots(root);
    if (index >= 0 && (!only || !Object.hasOwn(snapshots, only))) throw new Error('--only must name an existing help snapshot command');
    for (const command of Object.keys(snapshots).filter((name) => !only || name === only)) {
      const payload = await currentHelpSnapshot(command, root, runAtm);
      const file = path.join(helpSnapshotDirectory, `${command}.json`);
      const content = `${JSON.stringify(payload, null, 2)}\n`;
      if (!helpSnapshotMatches(command, payload, snapshots[command])) {
        writeFileSync(path.join(root, file), content);
        changed.push(file);
      }
    }
    hint = changed.length ? `changed: ${changed.join(', ')}` : 'no snapshot changes';
  } catch (error) {
    ok = false;
    hint = (error as Error).message;
  }
  console.log(formatAtmResultLine({ step: 'help-snapshots', status: ok ? 'ok' : 'fail', code: ok ? 'HELP_SNAPSHOTS_OK' : 'HELP_SNAPSHOTS_FAILED', log: '-', hint }));
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
