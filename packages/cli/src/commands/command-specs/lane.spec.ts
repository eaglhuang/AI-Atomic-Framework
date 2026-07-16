import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'lane',
  summary: 'Inspect, lazily mint, or explicitly adopt an ATM lane session and echo the lane envelope for tool callers.',
  positional: [
    { name: 'action', summary: 'status | adopt <lane-id>', required: false }
  ],
  options: [
    commonCwdOption,
    { flag: '--lane-session-id', value: 'id', summary: 'Lane session id to resolve before falling back to ATM_LANE_SESSION_ID.' },
    { flag: '--lane-session', value: 'id', summary: 'Alias for --lane-session-id.' },
    { flag: '--actor', value: 'id', summary: 'Actor id used when a missing or stale lane must be lazily minted, or when adopting a lane.' },
    { flag: '--reason', value: 'text', summary: 'Optional reason recorded when adopting a lane.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs lane status --json',
    'node atm.mjs lane status --actor codex-main --json',
    'node atm.mjs lane status --lane-session-id lane-20260716000000-codex-main-abc123 --json',
    'node atm.mjs lane adopt lane-20260716000000-codex-main-abc123 --actor codex-main --json'
  ]
});
