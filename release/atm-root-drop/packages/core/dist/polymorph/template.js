function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function createLazyInstantiationContract(template, dimensionSpec) {
    const templateRecord = asRecord(template);
    const dimensionSpecRecord = asRecord(dimensionSpec);
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
export function propagateTemplateUpgrade(options) {
    const optionRecord = asRecord(options);
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
        const instanceRecord = asRecord(instance) ?? {};
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
