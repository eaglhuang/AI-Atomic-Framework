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
export declare function analyzePolymorphImpact(options: any): {
    targetMapId: string;
    toVersion: string;
    templateHits: TemplateHitRecord[];
    impactedMapIds: string[];
    impactedMaps: ImpactedMapRecord[];
    propagation: {
        templateId: string;
        toVersion: string;
        propagatedCount: any;
        propagationMode: string;
        propagatedInstances: any;
    }[];
    reportRequired: boolean;
};
export declare function createPolymorphImpactReport(options: any): {
    toVersion: string;
    templateHits: TemplateHitRecord[];
    impactedMapIds: string[];
    impactedMaps: ImpactedMapRecord[];
    propagation: {
        templateId: string;
        toVersion: string;
        propagatedCount: any;
        propagationMode: string;
        propagatedInstances: any;
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
    reportId: any;
    generatedAt: string;
    targetMapId: string;
};
export {};
