import { type TeamRoleSkillPackContract } from './role-skill-packs.ts';
export type TeamGrowthContract = {
    schemaId: 'atm.teamGrowthContract.v1';
    sharedAcrossRolePacks: true;
    taxonomy: string[];
    captureTemplate: string[];
    promotionPolicy: {
        stableRuleTarget: string;
        rawCaseTarget: string;
    };
};
export type TeamRoleGrowthObservabilityContract = {
    schemaId: 'atm.teamRoleGrowthObservabilityContract.v1';
    sharedAcrossRolePacks: true;
    referenceFirst: true;
    sourceGrowthContract: 'atm.teamGrowthContract.v1';
    sourceObservabilityContract: 'atm.teamAgentObservabilityContract.v1';
    learningEventProjection: {
        eventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
        eventType: 'artifact.output';
        artifactType: 'atm.teamRoleGrowthLearningItem.v1';
        queryKeys: string[];
        artifactFields: string[];
    };
    frictionClassification: {
        sharedAtmRoutingFriction: string[];
        roleSpecificFriction: string[];
    };
    roleMappings: Array<{
        role: string;
        agentId: string;
        skillPackId: string;
        playbookSlice: string;
        growthAttachmentPoint: string;
        learningReference: string;
        taxonomy: string[];
        observableEventSelector: {
            role: string;
            eventType: 'artifact.output';
            artifactType: 'atm.teamRoleGrowthLearningItem.v1';
        };
    }>;
    metrics: Array<{
        metricId: string;
        description: string;
        numerator: Record<string, string>;
        denominator: Record<string, string>;
        groupedBy: string[];
    }>;
    brokerConflictVocabulary: {
        decisionClass: string;
        decisionReason: string;
        violationStatus: string;
        blockedCode: 'broker-conflict-blocked';
    };
};
export declare function buildTeamGrowthContract(): TeamGrowthContract;
export declare function buildTeamRoleGrowthObservabilityContract(input: {
    roleSkillPacks: TeamRoleSkillPackContract;
    growthContract?: TeamGrowthContract;
}): TeamRoleGrowthObservabilityContract;
