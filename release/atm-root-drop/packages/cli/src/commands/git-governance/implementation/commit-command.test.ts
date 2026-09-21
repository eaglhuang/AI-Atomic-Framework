import assert from 'node:assert/strict';
import { permitsTerminalRepairClosureSessionBypass } from './commit-command.ts';

assert.equal(permitsTerminalRepairClosureSessionBypass(null), false);
assert.equal(permitsTerminalRepairClosureSessionBypass({ origin: 'claim' }), false);
assert.equal(permitsTerminalRepairClosureSessionBypass({ origin: 'repair-closure' }), true);

console.log('commit-command: terminal repair-closure session bypass ok');
