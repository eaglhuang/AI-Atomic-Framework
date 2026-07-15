import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildModelPriceRefreshReport, refreshCatalogHashes } from '../../scripts/pricing/refresh-model-prices.ts';

const sources = JSON.parse(readFileSync('specs/pricing/model-pricing-sources.json', 'utf8'));
const catalog = JSON.parse(readFileSync('specs/pricing/model-standard-token-prices.json', 'utf8'));
const refreshed = refreshCatalogHashes(catalog, sources);
const report = buildModelPriceRefreshReport(refreshed, sources);

function mustFind(predicate: (row: any) => boolean) {
  const row = refreshed.prices.find(predicate);
  assert.ok(row, 'expected price row to exist');
  return row;
}

assert.equal(refreshed.catalogVersion, '2026-07-15.standard');
assert.equal(report.schemaId, 'atm.modelPriceRefreshReport.v1');
assert.equal(report.sourceCount, 4);
assert.equal(report.priceRowCount, refreshed.prices.length);
assert.deepEqual(report.missingOfficialSourceRows, []);

const openAiMini = mustFind((row: any) => row.provider === 'openai' && row.model === 'gpt-5.4-mini');
assert.equal(openAiMini.rates.input, 0.75);
assert.equal(openAiMini.rates.cacheRead, 0.075);
assert.equal(openAiMini.rates.output, 4.5);

const openAiTerra = mustFind((row: any) => row.provider === 'openai' && row.model === 'gpt-5.6-terra');
assert.equal(openAiTerra.rates.input, 2.5);
assert.equal(openAiTerra.rates.cacheWrite, 3.125);
assert.equal(openAiTerra.rates.output, 15);

const anthropic = mustFind((row: any) => row.provider === 'anthropic' && row.model === 'claude-fable-5');
assert.equal(anthropic.rates.cacheWrite, 12.5);
assert.equal(anthropic.rates.cacheRead, 1);
assert.equal(anthropic.rates.output, 50);

const gemini = mustFind((row: any) => row.provider === 'gemini-direct' && row.model === 'gemini-3.1-flash-lite');
assert.equal(gemini.rates.input, 0.25);
assert.equal(gemini.rates.cacheRead, 0.025);
assert.equal(gemini.rates.output, 1.5);

const copilot = mustFind((row: any) => row.provider === 'claude-code');
assert.equal(copilot.rates.seatMonth, 10);

for (const row of refreshed.prices) {
  assert.match(row.sourceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(row.officialSourceUrl.startsWith('https://'), true);
}

console.log('[model-price-refresh] ok');
