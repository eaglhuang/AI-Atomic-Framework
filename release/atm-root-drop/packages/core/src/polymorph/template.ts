interface TemplateRecord {
  readonly templateId?: string;
  readonly templateAtomId?: string;
}

interface DimensionSpecRecord {
  readonly dimensionSpecId?: string;
  readonly variantKey?: string;
}

interface TemplateUpgradeOptions {
  readonly templateId?: string;
  readonly toVersion?: string;
  readonly instances?: unknown[];
}

interface TemplateInstanceRecord {
  readonly mapId?: string;
  readonly [key: string]: unknown;
}

function asRecord<T extends object>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as T
    : null;
}

export function createLazyInstantiationContract(template: unknown, dimensionSpec: unknown) {
  const templateRecord = asRecord<TemplateRecord>(template);
  const dimensionSpecRecord = asRecord<DimensionSpecRecord>(dimensionSpec);
  const templateId = String(templateRecord?.templateId || '').trim();
  const dimensionSpecId = String(dimensionSpecRecord?.dimensionSpecId || '').trim();
  const variantKey = String(dimensionSpecRecord?.variantKey || 'default').trim() || 'default';

  if (!templateId) {
    throw new Error('polymorphic template requires templateId');
  }
  if (!dimensionSpecId) {
    throw new Error('dimension spec requires dimensionSpecId');
  }

  return {
    templateId,
    dimensionSpecId,
    variantKey,
    registryExpansion: 'none',
    materializedInRegistry: false,
    instantiateOn: 'runtime',
    instanceStatus: 'validated',
    runtimeInstanceId: `${String(templateRecord?.templateAtomId || 'ATM-TEMPLATE-0000')}@${variantKey}`
  };
}

export function propagateTemplateUpgrade(options: unknown) {
  const optionRecord = asRecord<TemplateUpgradeOptions>(options);
  const templateId = String(optionRecord?.templateId || '').trim();
  const toVersion = String(optionRecord?.toVersion || '').trim();
  const instances = Array.isArray(optionRecord?.instances) ? optionRecord.instances : [];

  if (!templateId) {
    throw new Error('propagateTemplateUpgrade requires templateId');
  }
  if (!toVersion) {
    throw new Error('propagateTemplateUpgrade requires toVersion');
  }

  const propagatedInstances = instances.map((instance) => {
    const instanceRecord = asRecord<TemplateInstanceRecord>(instance) ?? {};
    return {
      ...instanceRecord,
    inheritedTemplateVersion: toVersion,
    inheritedBy: 'behavior.evolve',
    needsRegistryWrite: false
    };
  });

  return {
    templateId,
    toVersion,
    propagatedCount: propagatedInstances.length,
    propagationMode: 'auto-propagate-all-instances',
    propagatedInstances
  };
}

export default {
  createLazyInstantiationContract,
  propagateTemplateUpgrade
};
