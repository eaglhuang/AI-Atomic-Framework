import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createAgentsRootEntryBlock, createReadmeRootEntryBlock } from '../../_vendor/plugin-governance-local/dist/bootstrap/bootstrap/root-entry-patching.js';
import { losslessUtf8 } from '../../_vendor/integrations-core/dist/manifest/safe-install.js';
import { CliError } from '../shared.js';
/** Protect existing root blocks before the legacy bootstrap writer runs. */
export function preflightBootstrap(cwd) {
    const expected = [
        { file: 'AGENTS.md', start: '<!-- ATM ROOT ENTRY:START -->', end: '<!-- ATM ROOT ENTRY:END -->', content: createAgentsRootEntryBlock({
                BOOTSTRAP_TASK_PATH: '.atm/history/tasks/BOOTSTRAP-0001.json',
                BOOTSTRAP_PROFILE_PATH: '.atm/runtime/profile/default.md',
                BOOTSTRAP_EVIDENCE_PATH: '.atm/runtime/evidence-ledger/bundles/BOOTSTRAP-0001.json'
            }) },
        { file: 'README.md', start: '<!-- ATM README ENTRY:START -->', end: '<!-- ATM README ENTRY:END -->', content: createReadmeRootEntryBlock() }
    ];
    for (const entry of expected) {
        const absolute = path.join(cwd, entry.file);
        if (!existsSync(absolute))
            continue;
        if (!lstatSync(absolute).isFile())
            throw new CliError('ATM_SETUP_INVALID_TARGET', `${entry.file} must be a regular file.`);
        const text = losslessUtf8(readFileSync(absolute));
        const starts = text.split(entry.start).length - 1, ends = text.split(entry.end).length - 1;
        if (starts === 0 && ends === 0)
            continue;
        const start = text.indexOf(entry.start), end = text.indexOf(entry.end);
        if (starts !== 1 || ends !== 1 || end < start
            || text.slice(start, end + entry.end.length).replace(/\r\n/g, '\n') !== entry.content) {
            throw new CliError('ATM_SETUP_ROOT_ENTRY_CONFLICT', `Preserve edited or malformed ATM block in ${entry.file}; review that block before retrying setup.`);
        }
    }
    const packageFile = path.join(cwd, 'package.json');
    if (existsSync(packageFile))
        JSON.parse(losslessUtf8(readFileSync(packageFile)));
}
