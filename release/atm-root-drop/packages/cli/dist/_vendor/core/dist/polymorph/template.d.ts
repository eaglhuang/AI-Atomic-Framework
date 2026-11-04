export declare function createLazyInstantiationContract(template: unknown, dimensionSpec: unknown): {
    templateId: string;
    dimensionSpecId: string;
    variantKey: string;
    registryExpansion: string;
    materializedInRegistry: boolean;
    instantiateOn: string;
    instanceStatus: string;
    runtimeInstanceId: string;
};
export declare function propagateTemplateUpgrade(options: unknown): {
    templateId: string;
    toVersion: string;
    propagatedCount: number;
    propagationMode: string;
    propagatedInstances: {
        inheritedTemplateVersion: string;
        inheritedBy: string;
        needsRegistryWrite: boolean;
        mapId?: string;
    }[];
};
declare const _default: {
    createLazyInstantiationContract: typeof createLazyInstantiationContract;
    propagateTemplateUpgrade: typeof propagateTemplateUpgrade;
};
export default _default;
