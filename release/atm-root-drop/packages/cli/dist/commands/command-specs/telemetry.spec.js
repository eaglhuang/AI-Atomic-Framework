import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'telemetry',
    summary: 'Manage opt-in ATM CLI telemetry and local governance gate telemetry for the current repository.',
    positional: [],
    options: [
        commonCwdOption,
        { flag: '--on', summary: 'Opt in to telemetry for this repository.' },
        { flag: '--off', summary: 'Opt out of telemetry for this repository.' },
        { flag: '--status', summary: 'Show telemetry status (default action).' },
        { flag: '--endpoint', value: 'url', summary: 'Optional telemetry endpoint recorded with opt-in.' },
        { flag: '--gate-registry', summary: 'Show the canonical local governance gate check registry.' },
        { flag: '--emit-fixture', summary: 'Write one local governance gate telemetry fixture event to gitignored runtime scratch.' },
        { flag: '--seal', summary: 'Seal local governance gate telemetry runtime events to immutable history.' },
        { flag: '--report', summary: 'Report local governance gate telemetry from sealed history.' },
        { flag: '--include-runtime', summary: 'Include runtime scratch in a diagnostic gate telemetry report.' },
        { flag: '--task', value: 'id', summary: 'Task id for local gate telemetry fixture or seal.' },
        { flag: '--window', value: 'id', summary: 'Window id for local gate telemetry seal.' },
        { flag: '--watermark', value: 'iso-time', summary: 'Watermark for local gate telemetry seal.' },
        { flag: '--gate', value: 'name', summary: 'Gate name for local fixture emission.' },
        { flag: '--check-id', value: 'id', summary: 'Canonical check id for local fixture emission.' },
        { flag: '--result', value: 'pass|block|warn|skip|error', summary: 'Result for local fixture emission.' },
        { flag: '--reason', value: 'class', summary: 'Reason class for local fixture emission.' },
        { flag: '--duration-ms', value: 'number', summary: 'Duration for local fixture emission.' },
        { flag: '--actor', value: 'id', summary: 'Actor id for local fixture emission.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs telemetry --status --json',
        'node atm.mjs telemetry --on --json',
        'node atm.mjs telemetry --off --json',
        'node atm.mjs telemetry --gate-registry --json',
        'node atm.mjs telemetry --emit-fixture --task ATM-GOV-0193 --json',
        'node atm.mjs telemetry --seal --task ATM-GOV-0193 --json',
        'node atm.mjs telemetry --report --json'
    ]
});
