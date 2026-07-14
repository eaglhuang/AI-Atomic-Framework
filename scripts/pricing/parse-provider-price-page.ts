import { createHash } from 'node:crypto';

export type PricingSource = {
  readonly provider: string;
  readonly url: string;
  readonly evidence: readonly string[];
};

export function sourceHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function normalizeModelText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function sourceHashForProviderModel(sources: readonly PricingSource[], provider: string, model: string): string {
  const source = sources.find((entry) => entry.provider === provider);
  if (!source) {
    throw new Error(`Missing pricing source for provider: ${provider}`);
  }
  const normalizedModel = normalizeModelText(model);
  const evidence = source.evidence.find((entry) => normalizeModelText(entry).includes(normalizedModel))
    ?? source.evidence.join('\n');
  return sourceHash(`${source.url}\n${evidence}`);
}
