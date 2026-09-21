import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('packages/cli/src/commands/tasks/repairclose-orchestrator.ts', 'utf8');
const freshness = source.indexOf('const staleGate = assertRunnerFreshForWriteAction');
const approval = source.indexOf('emergencyUse = assertEmergencyApproval');
assert.ok(freshness >= 0 && approval >= 0 && freshness < approval, 'freshness must fail before consuming an emergency repair lease');
assert.ok(source.includes('issueRepairClosureAdmissionTicket'), 'repair must persist its follow-up commit authority');
assert.ok(source.includes('workAdmissionTicketId'), 'repair result must expose the durable follow-up commit authority');
console.log('[repair-closure-emergency-atomicity] ok');
