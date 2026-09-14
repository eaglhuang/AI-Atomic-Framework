import { strict as assert } from 'node:assert';
import {
  atmChartSourceSchemas,
  embeddedATMChartSchemaAssets,
  resolveATMChartSchemaSource
} from '../../packages/cli/src/commands/atm-chart/constants.ts';

const logicalPaths = Object.values(atmChartSourceSchemas);
assert.deepEqual(
  Object.keys(embeddedATMChartSchemaAssets).sort(),
  [...logicalPaths].sort(),
  'every public ATMChart schema must have one embedded logical asset digest'
);
for (const logicalPath of logicalPaths) {
  const embedded = embeddedATMChartSchemaAssets[logicalPath as keyof typeof embeddedATMChartSchemaAssets];
  assert.match(embedded.sha256, /^sha256:[0-9a-f]{64}$/);
  const resolved = resolveATMChartSchemaSource(logicalPath);
  assert.ok(resolved, `schema source must resolve in the source runner: ${logicalPath}`);
}

assert.equal(
  resolveATMChartSchemaSource('schemas/not-a-public-chart-schema.schema.json'),
  null,
  'unknown schema paths must remain fail-closed'
);

console.log('[atm-chart-public-runtime] ok');
