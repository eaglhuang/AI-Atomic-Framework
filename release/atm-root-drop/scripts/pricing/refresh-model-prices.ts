import { readFileSync, writeFileSync } from 'node:fs';
import { sourceHashForProviderModel } from './parse-provider-price-page.ts';

type Catalog = {
  catalogVersion: string;
  retrievedAt: string;
  prices: Array<{
    provider: string;
    model: string;
    officialSourceUrl: string;
    sourceHash: string;
    rates: Record<string, number>;
  }>;
};

const sourcePath = 'specs/pricing/model-pricing-sources.json';
const catalogPath = 'specs/pricing/model-standard-token-prices.json';

export function buildModelPriceRefreshReport(catalog: Catalog, sources: { sources: any[] }) {
  const rows = catalog.prices.map((row) => ({
    provider: row.provider,
    model: row.model,
    officialSourceUrl: row.officialSourceUrl,
    sourceHash: row.sourceHash,
    hasUsdRate: Object.values(row.rates).some((value) => typeof value === 'number' && Number.isFinite(value))
  }));
  return {
    schemaId: 'atm.modelPriceRefreshReport.v1',
    catalogVersion: catalog.catalogVersion,
    retrievedAt: catalog.retrievedAt,
    sourceCount: sources.sources.length,
    priceRowCount: catalog.prices.length,
    missingOfficialSourceRows: rows.filter((row) => !row.officialSourceUrl).map((row) => `${row.provider}:${row.model}`),
    rows
  };
}

export function refreshCatalogHashes(catalog: Catalog, sources: { sources: any[] }): Catalog {
  return {
    ...catalog,
    prices: catalog.prices.map((row) => ({
      ...row,
      sourceHash: sourceHashForProviderModel(sources.sources, row.provider, row.model)
    }))
  };
}

if (process.argv[1]?.endsWith('refresh-model-prices.ts')) {
  const sources = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog;
  const refreshed = refreshCatalogHashes(catalog, sources);
  writeFileSync(catalogPath, `${JSON.stringify(refreshed, null, 2)}\n`, 'utf8');
  const report = buildModelPriceRefreshReport(refreshed, sources);
  writeFileSync('specs/pricing/model-price-refresh-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
