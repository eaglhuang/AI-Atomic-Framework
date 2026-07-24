import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'write-ticket',
  summary: 'Acquire and check task-scoped write tickets before editor writes, record post-write touched paths, and classify scope amendment, unattached WIP, stale ticket, missing ticket, and true violation outcomes.',
  positional: [
    { name: 'action', summary: 'acquire | check | record-touch | status', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id that owns the requested write authority.' },
    { flag: '--actor', value: 'id', summary: 'Actor id requesting or checking the write ticket.' },
    { flag: '--files', value: 'csv', summary: 'Comma-separated files being acquired, checked, or recorded as touched.' },
    { flag: '--file', value: 'path', summary: 'Single file alias for --files.' },
    { flag: '--intent', value: 'text', summary: 'Ticket intent such as write, stage, commit, close, or push.' },
    { flag: '--operation', value: 'kind', summary: 'Operation boundary: write | stage | commit | close | push.' },
    { flag: '--observed', value: 'phase', summary: 'Observation phase: pre-write | post-write | commit | close | push.' },
    { flag: '--ticket', value: 'path', summary: 'Path to an existing write-ticket JSON document for check/status.' },
    { flag: '--ticket-file', value: 'path', summary: 'Alias for --ticket.' },
    { flag: '--lane-session', value: 'id', summary: 'Lane session id to compare against ticket and claim authority.' },
    { flag: '--lane-session-id', value: 'id', summary: 'Alias for --lane-session.' },
    { flag: '--ttl-seconds', value: 'seconds', summary: 'Ticket TTL for acquire; defaults to 3600 seconds.' },
    { flag: '--recovery-bypassed', summary: 'Escalate unresolved out-of-scope evidence to true violation at delivery boundary.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs write-ticket acquire --task TASK-0001 --actor codex --files src/a.ts --intent write --json',
    'node atm.mjs write-ticket check --task TASK-0001 --actor codex --ticket .atm/runtime/write-ticket.json --files src/a.ts --json',
    'node atm.mjs write-ticket record-touch --task TASK-0001 --actor codex --ticket .atm/runtime/write-ticket.json --files src/b.ts --observed post-write --json',
    'node atm.mjs write-ticket status --task TASK-0001 --actor codex --ticket .atm/runtime/write-ticket.json --files src/a.ts --json'
  ]
});
