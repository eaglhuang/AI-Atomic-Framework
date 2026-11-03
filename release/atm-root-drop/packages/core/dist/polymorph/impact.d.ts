interface PolymorphMetadataRecord {
    readonly templateId: string;
    readonly polymorphGroupId: string;
}
interface TemplateHitRecord extends PolymorphMetadataRecord {
    readonly atomId: string;
    readonly version: string;
}
interface ImpactedMapRecord {
    readonly mapId: string;
    readonly templateIds: string[];
    readonly matchedMembers: TemplateHitRecord[];
}
interface PolymorphImpactOptions {
    readonly repositoryRoot?: string;
    readonly mapId?: string;
    readonly targetMapId?: string;
    readonly toVersion?: string;
    readonly nextVersion?: string;
    readonly generatedAt?: string;
    readonly reportId?: string;
    readonly requestedReplacementMode?: string;
    readonly atomId?: string;
}
export declare function analyzePolymorphImpact(options: PolymorphImpactOptions): {
    targetMapId: string;
    toVersion: string;
    templateHits: TemplateHitRecord[];
    impactedMapIds: string[];
    impactedMaps: ImpactedMapRecord[];
    propagation: {
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
    }[];
    reportRequired: boolean;
};
export declare function createPolymorphImpactReport(options: PolymorphImpactOptions): {
    toVersion: string;
    templateHits: TemplateHitRecord[];
    impactedMapIds: string[];
    impactedMaps: ImpactedMapRecord[];
    propagation: {
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
    }[];
    artifacts: {
        artifactPath: string;
        artifactKind: string;
        producedBy: string;
    }[];
    evidence: {
        summary: string;
        artifactPaths: string[];
        atomId?: string | undefined;
        evidenceKind: string;
        signalScope: string;
        atomMapId: string;
    }[];
    passed: boolean;
    atomId?: string | undefined;
    requestedReplacementMode?: string | undefined;
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    reportId: string;
    generatedAt: string;
    targetMapId: string;
};
export {};
