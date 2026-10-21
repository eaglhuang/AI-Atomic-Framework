import assert from 'node:assert/strict';
import { formatAtmResultLine, parseAtmResultLine } from '../../scripts/lib/atm-result-line.ts';

const result = { step: 'sealed-build', status: 'fail' as const, code: 'BUILD_STEP_FAILED', log: '/tmp/build log.txt', hint: 'step "packages" failed\nsee log\rretry \\build' };
const line = formatAtmResultLine(result);
assert.equal(line.split('\n').length, 1);
assert.deepEqual(parseAtmResultLine(line), result);
assert.equal(formatAtmResultLine({ ...result, hint: '', log: '-' }), 'ATM-RESULT step=sealed-build status=fail code=BUILD_STEP_FAILED log=- hint=""');
for (const invalid of ['', 'ATM-RESULT', line.replace('status=fail', 'status=bad'), line.replace('BUILD_STEP_FAILED', 'bad-code'), line + '\n', line.replace('hint=', 'hint=bad')]) {
  assert.equal(parseAtmResultLine(invalid), null);
}
assert.throws(() => formatAtmResultLine({ ...result, code: 'bad-code' }));
assert.throws(() => formatAtmResultLine({ ...result, log: 'bad\npath' }));
console.log('[atm-result-line] ok');
