import { createHash } from 'node:crypto';

export const OBLIGATION_INVENTORY_SCHEMA_ID = 'atm.obligationInventory.v1' as const;
export const OBLIGATION_INVENTORY_DRIFT_SCHEMA_ID = 'atm.obligationInventoryDrift.v1' as const;

export type ObligationLifecycleStatus = 'active' | 'deprecated' | 'excluded' | 'draft';

export interface ObligationSourceRef {
  readonly kind: 'file' | 'schema' | 'task' | 'plan' | 'seam' | 'other';
  readonly ref: string;
}

export interface ObligationValidatorRef {
  readonly command: string;
  readonly caseId?: string | null;
}

export interface ObligationInventoryEntryInput {
  readonly obligationId: string;
  readonly semanticFamily: string;
  readonly owningSeam: string;
  readonly lifecycleStatus: ObligationLifecycleStatus;
  readonly sourceRefs?: readonly ObligationSourceRef[];
  readonly validatorRefs?: readonly ObligationValidatorRef[];
  readonly description?: string | null;
  readonly observedAt?: string | null;
}

export interface ObligationInventoryEntry extends ObligationInventoryEntryInput {
  readonly sourceRefs: readonly ObligationSourceRef[];
  readonly validatorRefs: readonly ObligationValidatorRef[];
  readonly entryDigest: string;
}

export interface ObligationInventoryInput {
  readonly inventoryId: string;
  readonly modelId: string;
  readonly generatedAt: string;
  readonly entries: readonly ObligationInventoryEntryInput[];
}

export interface ObligationInventory extends Omit<ObligationInventoryInput, 'entries'> {
  readonly schemaId: typeof OBLIGATION_INVENTORY_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly entries: readonly ObligationInventoryEntry[];
  readonly inventoryDigest: string;
}

export type ObligationDriftKind = 'added' | 'removed' | 'changed' | 'stale-observed';

export interface ObligationDriftItem {
  readonly obligationId: string;
  readonly kind: ObligationDriftKind;
  readonly previousDigest: string | null;
  readonly currentDigest: string | null;
  readonly reason: string;
}

export interface ObligationInventoryDrift {
  readonly schemaId: typeof OBLIGATION_INVENTORY_DRIFT_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly previousInventoryDigest: string;
  readonly currentInventoryDigest: string;
  readonly staleCertificateId: string | null;
  readonly staleCertificateDigest: string | null;
  readonly changed: boolean;
  readonly items: readonly ObligationDriftItem[];
}

export function createObligationInventory(input: ObligationInventoryInput): ObligationInventory {
  const entries = normalizeEntries(input.entries);
  const inventoryDigest = digestCanonical({
    inventoryId: normalizeText(input.inventoryId),
    modelId: normalizeText(input.modelId),
    entries: entries.map((entry) => ({
      obligationId: entry.obligationId,
      semanticFamily: entry.semanticFamily,
      owningSeam: entry.owningSeam,
      lifecycleStatus: entry.lifecycleStatus,
      sourceRefs: entry.sourceRefs,
      validatorRefs: entry.validatorRefs,
      description: entry.description ?? null,
      observedAt: entry.observedAt ?? null,
      entryDigest: entry.entryDigest
    }))
  });

  return {
    schemaId: OBLIGATION_INVENTORY_SCHEMA_ID,
    specVersion: '0.1.0',
    inventoryId: normalizeText(input.inventoryId),
    modelId: normalizeText(input.modelId),
    generatedAt: normalizeText(input.generatedAt),
    entries,
    inventoryDigest
  };
}

export function detectObligationInventoryDrift(input: {
  readonly previous: ObligationInventory;
  readonly current: ObligationInventory;
  readonly staleObservedBefore?: string | null;
  readonly staleCertificateId?: string | null;
  readonly staleCertificateDigest?: string | null;
}): ObligationInventoryDrift {
  const previousById = indexByObligationId(input.previous.entries);
  const currentById = indexByObligationId(input.current.entries);
  const staleObservedBefore = normalizeNullableText(input.staleObservedBefore);
  const items: ObligationDriftItem[] = [];

  for (const id of [...previousById.keys()].sort()) {
    if (!currentById.has(id)) {
      const previous = previousById.get(id)!;
      items.push({
        obligationId: id,
        kind: 'removed',
        previousDigest: previous.entryDigest,
        currentDigest: null,
        reason: 'Obligation existed in the previous inventory but is absent from the current inventory.'
      });
    }
  }

  for (const id of [...currentById.keys()].sort()) {
    const current = currentById.get(id)!;
    const previous = previousById.get(id) ?? null;
    if (!previous) {
      items.push({
        obligationId: id,
        kind: 'added',
        previousDigest: null,
        currentDigest: current.entryDigest,
        reason: 'Obligation is new in the current inventory.'
      });
    } else if (previous.entryDigest !== current.entryDigest) {
      items.push({
        obligationId: id,
        kind: 'changed',
        previousDigest: previous.entryDigest,
        currentDigest: current.entryDigest,
        reason: 'Obligation semantic content changed between inventories.'
      });
    }

    if (staleObservedBefore && current.observedAt && current.observedAt < staleObservedBefore) {
      items.push({
        obligationId: id,
        kind: 'stale-observed',
        previousDigest: previous?.entryDigest ?? null,
        currentDigest: current.entryDigest,
        reason: `Obligation observation timestamp ${current.observedAt} is older than ${staleObservedBefore}.`
      });
    }
  }

  const sortedItems = items.sort((left, right) =>
    left.obligationId.localeCompare(right.obligationId) || left.kind.localeCompare(right.kind)
  );

  return {
    schemaId: OBLIGATION_INVENTORY_DRIFT_SCHEMA_ID,
    specVersion: '0.1.0',
    previousInventoryDigest: input.previous.inventoryDigest,
    currentInventoryDigest: input.current.inventoryDigest,
    staleCertificateId: normalizeNullableText(input.staleCertificateId),
    staleCertificateDigest: normalizeNullableText(input.staleCertificateDigest),
    changed: input.previous.inventoryDigest !== input.current.inventoryDigest || sortedItems.length > 0,
    items: sortedItems
  };
}

function normalizeEntries(entries: readonly ObligationInventoryEntryInput[]): ObligationInventoryEntry[] {
  return entries
    .map((entry) => {
      const normalized = {
        obligationId: normalizeText(entry.obligationId),
        semanticFamily: normalizeText(entry.semanticFamily),
        owningSeam: normalizeText(entry.owningSeam),
        lifecycleStatus: entry.lifecycleStatus,
        sourceRefs: normalizeSourceRefs(entry.sourceRefs),
        validatorRefs: normalizeValidatorRefs(entry.validatorRefs),
        description: normalizeNullableText(entry.description),
        observedAt: normalizeNullableText(entry.observedAt)
      };
      return {
        ...normalized,
        entryDigest: digestCanonical(normalized)
      };
    })
    .filter((entry) => entry.obligationId && entry.semanticFamily && entry.owningSeam)
    .sort((left, right) => left.obligationId.localeCompare(right.obligationId));
}

function normalizeSourceRefs(values: readonly ObligationSourceRef[] = []): ObligationSourceRef[] {
  return values
    .map((entry) => ({ kind: entry.kind, ref: normalizeText(entry.ref) }))
    .filter((entry) => entry.ref)
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
}

function normalizeValidatorRefs(values: readonly ObligationValidatorRef[] = []): ObligationValidatorRef[] {
  return values
    .map((entry) => ({ command: normalizeText(entry.command), caseId: normalizeNullableText(entry.caseId) }))
    .filter((entry) => entry.command)
    .sort((left, right) => left.command.localeCompare(right.command) || String(left.caseId ?? '').localeCompare(String(right.caseId ?? '')));
}

function indexByObligationId(entries: readonly ObligationInventoryEntry[]): Map<string, ObligationInventoryEntry> {
  return new Map(entries.map((entry) => [entry.obligationId, entry]));
}

function digestCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}
