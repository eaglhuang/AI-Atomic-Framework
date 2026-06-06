export declare function createLazyInstantiationContract(template: any, dimensionSpec: any): {
    templateId: string;
    dimensionSpecId: string;
    variantKey: string;
    registryExpansion: string;
    materializedInRegistry: boolean;
    instantiateOn: string;
    instanceStatus: string;
    runtimeInstanceId: string;
};
export declare function propagateTemplateUpgrade(options: any): {
    templateId: string;
    toVersion: string;
    propagatedCount: any;
    propagationMode: string;
    propagatedInstances: any;
};
declare const _default: {
    createLazyInstantiationContract: typeof createLazyInstantiationContract;
    propagateTemplateUpgrade: typeof propagateTemplateUpgrade;
};
export default _default;
