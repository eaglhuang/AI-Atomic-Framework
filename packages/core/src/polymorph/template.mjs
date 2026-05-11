export function createLazyInstantiationContract(template, dimensionSpec) {
  const templateId = String(template?.templateId || '').trim();
  const dimensionSpecId = String(dimensionSpec?.dimensionSpecId || '').trim();
  const variantKey = String(dimensionSpec?.variantKey || 'default').trim() || 'default';

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
    runtimeInstanceId: `${String(template?.templateAtomId || 'ATM-TEMPLATE-0000')}@${variantKey}`
  };
}

export function propagateTemplateUpgrade(options) {
  const templateId = String(options?.templateId || '').trim();
  const toVersion = String(options?.toVersion || '').trim();
  const instances = Array.isArray(options?.instances) ? options.instances : [];

  if (!templateId) {
    throw new Error('propagateTemplateUpgrade requires templateId');
  }
  if (!toVersion) {
    throw new Error('propagateTemplateUpgrade requires toVersion');
  }

  const propagatedInstances = instances.map((instance) => ({
    ...instance,
    inheritedTemplateVersion: toVersion,
    inheritedBy: 'behavior.evolve',
    needsRegistryWrite: false
  }));

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
