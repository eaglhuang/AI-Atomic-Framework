import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'lane',
    summary: 'Inspect, lazily mint, heartbeat, sweep, or explicitly adopt an ATM lane session and echo the lane envelope for tool callers.',
    positional: [
        { name: 'action', summary: 'status | adopt <lane-id> | heartbeat [lane-id] | sweep', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--lane-session-id', value: 'id', summary: 'Lane session id to resolve before falling back to ATM_LANE_SESSION_ID.' },
        { flag: '--lane-session', value: 'id', summary: 'Alias for --lane-session-id.' },
        { flag: '--actor', value: 'id', summary: 'Actor id used when a missing or stale lane must be lazily minted, or when adopting a lane.' },
        { flag: '--reason', value: 'text', summary: 'Optional reason recorded when adopting a lane.' },
        { flag: '--confirm', summary: 'Confirm adoption of a still-live lane owned by the same actor.' },
        { flag: '--handoff-token', value: 'token', summary: 'Authorize adoption of a still-live lane with its handoff token.' },
        { flag: '--grace-ms', value: 'ms', summary: 'Grace period used by lane sweep before a TTL-expired lane becomes sweepable.' },
        { flag: '--write', summary: 'For lane sweep, expire sweepable lanes and write sweep events. Without --write, sweep is report-only.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs lane status --json',
        'node atm.mjs lane status --actor codex-main --json',
        'node atm.mjs lane status --lane-session-id lane-20260716000000-codex-main-abc123 --json',
        'node atm.mjs lane heartbeat lane-20260716000000-codex-main-abc123 --actor codex-main --json',
        'node atm.mjs lane sweep --json',
        'node atm.mjs lane sweep --grace-ms 60000 --write --json',
        'node atm.mjs lane adopt lane-20260716000000-codex-main-abc123 --actor codex-main --confirm --json'
    ]
});
